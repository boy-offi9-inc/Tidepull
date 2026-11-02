import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
  assert.deepEqual(list.stdout.trim().split("\n"), ["dash", "rss", "m3u", "hls", "direct", "generic"]);
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

test("cli: --cookies unlocks a login-protected file, warns about open permissions, and never prints the cookie", { skip: process.platform === "win32" }, async () => {
  const url = `${fx.base}/private/clip.mp4`;
  const jar = path.join(dir, "cookies.txt");
  const bad = path.join(dir, "bad-cookies.txt");
  await writeFile(jar, "# Netscape HTTP Cookie File\n127.0.0.1\tFALSE\t/\tFALSE\t0\tsession\ts3cr3t9f3a\n");
  await writeFile(bad, "127.0.0.1\tFALSE\t/\tFALSE\t0\tsession\twrong\n");
  await chmod(jar, 0o600);
  await chmod(bad, 0o600);

  assert.equal((await run("-q", "-P", dir, "-o", "locked1.%(ext)s", url)).status, 1, "no cookies: refused");
  assert.equal((await run("-q", "--cookies", bad, "-P", dir, "-o", "locked2.%(ext)s", url)).status, 1, "wrong cookie: refused");
  const ok = await run("-v", "--cookies", jar, "-P", dir, "-o", "locked3.%(ext)s", url);
  assert.equal(ok.status, 0);
  assert.ok(existsSync(path.join(dir, "locked3.mp4")));
  assert.ok(!(ok.stdout + ok.stderr).includes("s3cr3t9f3a"), "the cookie value must never appear in output");
  const info = await run("-q", "-j", "--cookies", jar, url);
  assert.ok(!info.stdout.toLowerCase().includes("cookie"), "-j output must not contain cookies");

  await chmod(jar, 0o644);
  assert.match((await run("-q", "--cookies", jar, "-P", dir, "-o", "locked4.%(ext)s", url)).stderr, /chmod 600/);
  assert.equal((await run("--cookies", path.join(dir, "missing.txt"), url)).status, 2);
});

test("cli: playlists: -j and -F list entries without downloading; --playlist-items selects", async () => {
  const feed = `${fx.base}/feed.xml`;
  const pl = JSON.parse((await run("-q", "-j", feed)).stdout);
  assert.equal(pl.kind, "playlist");
  assert.equal(pl.entries.length, 3);
  const table = (await run("-q", "-F", feed)).stdout;
  assert.match(table, /Episode one/);
  assert.match(table, /ep3\.mp3/);

  const out = path.join(dir, "pl");
  assert.equal((await run("-q", "-P", out, "--playlist-items", "1,3", feed)).status, 0);
  assert.ok(existsSync(path.join(out, "01 - Episode one.mp3")));
  assert.ok(existsSync(path.join(out, "03 - Episode_ three_.mp3")));
  assert.ok(!existsSync(path.join(out, "02 - Episode two.mp3")));
  assert.equal((await run("-q", "--playlist-items", "x", feed)).status, 2);
  const m3u = JSON.parse((await run("-q", "-j", `${fx.base}/list.m3u`)).stdout);
  assert.deepEqual(m3u.entries.map((e: { title: string }) => e.title), ["First song", "Second song"]);
});

test("cli: one failing playlist item does not stop the others (exit code 1)", async () => {
  const out = path.join(dir, "broken");
  const r = await run("-P", out, `${fx.base}/feed-broken.xml`);
  assert.equal(r.status, 1);
  assert.ok(existsSync(path.join(out, "01 - Good one.mp3")));
  assert.ok(existsSync(path.join(out, "03 - Good two.mp3")));
  assert.match(r.stderr, /404/);
});

test("cli: --download-archive works per playlist item, and --progress-json reports playlist events", async () => {
  const feed = `${fx.base}/feed.xml`;
  const arch = path.join(dir, "playlist-archive.txt");
  assert.equal((await run("-q", "-P", path.join(dir, "arc1"), "--download-archive", arch, feed)).status, 0);
  assert.equal((await readFile(arch, "utf8")).trim().split("\n").length, 3);
  const again = await run("-P", path.join(dir, "arc2"), "--download-archive", arch, feed);
  assert.equal(again.status, 0);
  assert.equal((again.stderr.match(/already in the archive/g) ?? []).length, 3);
  assert.ok(!existsSync(path.join(dir, "arc2")), "nothing is downloaded the second time");

  const ev = await run("--progress-json", "-P", path.join(dir, "ev"), "--playlist-items", "1", feed);
  const types = ev.stdout.trim().split("\n").map((l) => JSON.parse(l).type);
  assert.ok(types.includes("playlist") && types.includes("item") && types.at(-1) === "done");
});
