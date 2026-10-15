import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
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
const run = (...args: string[]) =>
  new Promise<{ status: number; stdout: string }>((resolve) =>
    execFile(process.execPath, ["src/cli.ts", ...args], { encoding: "utf8", env: { ...process.env, TIDEPULL_PLUGIN_DIR: path.join(dir, "none") } }, (err, stdout) =>
      resolve({ status: err ? Number((err as { code?: number }).code ?? 1) : 0, stdout }),
    ),
  );

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
