import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import type { TidepullEvent } from "../src/index.ts";
import { main } from "../src/main.ts";
import { startFixture, type Fixture } from "./fixture.ts";

let fx: Fixture;
let dir: string;
before(async () => {
  fx = await startFixture();
  dir = await mkdtemp(path.join(tmpdir(), "tidepull-cli-"));
});
after(async () => {
  await fx.close();
  await rm(dir, { recursive: true, force: true });
});

// async on purpose: spawnSync would block the event loop that serves the fixture
const runWith = (input: string | undefined, args: string[], env: Record<string, string> = {}) =>
  new Promise<{ status: number; stdout: string; stderr: string }>((resolve) => {
    const child = execFile(
      process.execPath,
      ["src/cli.ts", ...args],
      { encoding: "utf8", env: { ...process.env, TIDEPULL_PLUGIN_DIR: path.join(dir, "none"), ...env } },
      (err, stdout, stderr) => resolve({ status: err ? Number((err as { code?: number }).code ?? 1) : 0, stdout, stderr }),
    );
    child.stdin?.end(input);
  });
const run = (...args: string[]) => runWith(undefined, args);

test("cli: usage errors, -j, -g, exit codes", async () => {
  assert.equal((await run()).status, 2);
  assert.equal((await run("--bogus")).status, 2);
  assert.equal((await run("--help")).status, 0);
  const j = await run("-j", "-q", `${fx.base}/hls/master.m3u8`);
  assert.equal(j.status, 0);
  assert.equal(JSON.parse(j.stdout).formats.length, 2);
  assert.equal((await run("-q", `${fx.base}/missing.mp4`)).status, 1);
  const g = await run("-g", "-q", "-f", "hls-800", `${fx.base}/hls/master.m3u8`);
  assert.match(g.stdout.trim(), /\/hls\/low\/index\.m3u8$/);
  assert.equal(await main(["-q", "-s", `${fx.base}/media/clip.mp4`]), 0);
});

test("cli: --progress-json emits NDJSON events on stdout; --plugin works", async () => {
  const pfile = path.join(dir, "cli-plugin.mjs");
  await writeFile(pfile, `export default { name: "cli-demo", apiVersion: 1, extractors: [] };`);
  const r = await run("--progress-json", "--plugin", pfile, "-P", dir, "-o", "cli.%(ext)s", "-w", `${fx.base}/media/clip.mp4`);
  assert.equal(r.status, 0);
  const evs = r.stdout.trim().split("\n").map((l) => JSON.parse(l) as TidepullEvent);
  assert.equal(evs.at(-1)?.type, "done");
  assert.ok(evs.some((e) => e.type === "progress"));
  assert.equal((await run("--plugin", path.join(dir, "missing.mjs"), `${fx.base}/media/clip.mp4`)).status, 1);
});

test("cli: --version matches package.json; --list-extractors needs no URL", async () => {
  const pkg = JSON.parse(await readFile("package.json", "utf8"));
  assert.equal((await run("--version")).stdout.trim(), pkg.version);
  const list = await run("--list-extractors");
  assert.equal(list.status, 0);
  assert.deepEqual(list.stdout.trim().split("\n"), ["dash", "hls", "direct", "generic"]);
});

test("cli: --batch-file reads URLs (comments and blanks skipped); '-' reads stdin", async () => {
  const list = path.join(dir, "urls.txt");
  await writeFile(list, `# my list\n\n${fx.base}/media/clip.mp4\n  ${fx.base}/hls/master.m3u8  \n`);
  const r = await run("-q", "-j", "-a", list);
  assert.equal(r.status, 0);
  const lines = r.stdout.trim().split("\n");
  assert.deepEqual(lines.map((l) => JSON.parse(l).extractor), ["direct", "hls"]);
  const s = await runWith(`${fx.base}/media/clip.mp4\n`, ["-q", "-j", "-a", "-"]);
  assert.equal(s.stdout.trim().split("\n").length, 1);
  assert.equal((await run("-a", path.join(dir, "nope.txt"))).status, 2);
});

test("cli: --download-archive skips what was already downloaded", async () => {
  const arch = path.join(dir, "arch", "done.txt");
  const url = `${fx.base}/media/clip.mp4`;
  const first = await run("-q", "-P", dir, "-o", "arch1.%(ext)s", "--download-archive", arch, url);
  assert.equal(first.status, 0);
  assert.ok(existsSync(path.join(dir, "arch1.mp4")));
  assert.equal((await readFile(arch, "utf8")).trim(), `direct ${url}`);
  const second = await run("-P", dir, "-o", "arch2.%(ext)s", "--download-archive", arch, url);
  assert.equal(second.status, 0);
  assert.ok(!existsSync(path.join(dir, "arch2.mp4")), "second run must not download again");
  assert.match(second.stderr, /already in the archive/);
});

test("cli: config file supplies defaults, the command line wins, --no-config ignores it", async () => {
  const url = `${fx.base}/media/clip.mp4`;
  const cfg = path.join(dir, "tp.conf");
  await writeFile(cfg, `# defaults\n-P "${dir}"\n-o 'cfg-%(id)s.%(ext)s'\n--limit-rate 50M\n`);
  assert.equal((await run("-q", "--config-location", cfg, url)).status, 0);
  assert.ok(existsSync(path.join(dir, "cfg-clip.mp4")));
  assert.equal((await run("-q", "--config-location", cfg, "-o", "cli-%(id)s.%(ext)s", url)).status, 0);
  assert.ok(existsSync(path.join(dir, "cli-clip.mp4")), "command line overrides the config");

  const xdg = path.join(dir, "xdg");
  await mkdir(path.join(xdg, "tidepull"), { recursive: true });
  await writeFile(path.join(xdg, "tidepull", "config"), "--definitely-not-an-option\n");
  assert.equal((await runWith(undefined, ["-q", "-s", url], { XDG_CONFIG_HOME: xdg })).status, 2);
  assert.equal((await runWith(undefined, ["-q", "-s", "--no-config", url], { XDG_CONFIG_HOME: xdg })).status, 0);
  assert.equal((await run("--config-location", path.join(dir, "missing.conf"), url)).status, 2);
});

test("cli: --limit-rate is validated and slows the download", async () => {
  const url = `${fx.base}/media/clip.mp4`;
  assert.equal((await run("--limit-rate", "abc", url)).status, 2);
  const t0 = Date.now();
  assert.equal((await run("-q", "-P", dir, "-o", "slow.%(ext)s", "-w", "--limit-rate", "1M", url)).status, 0); // 1 MiB at 1 MiB/s
  assert.ok(Date.now() - t0 >= 900, `took ${Date.now() - t0} ms`);
});
