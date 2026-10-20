import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { findFfmpeg } from "../src/core/ffmpeg.ts";
import { createTidepull, type DownloadOptions, type Info, type TidepullEvent } from "../src/index.ts";
import { startFixture, type Fixture } from "./fixture.ts";

let fx: Fixture;
let b: Fixture;
let dir: string;
const g = createTidepull({ http: { retries: 2 } });
const extractInfo = (url: string) => g.extract(url);
const downloadInfo = (info: Info, o: Partial<DownloadOptions> = {}) =>
  g.download(info, { output: "%(id)s.%(ext)s", paths: dir, overwrite: true, concurrency: 3, ...o });
const same = (a: Buffer, b: Buffer) => assert.ok(a.equals(b), "file contents differ");


before(async () => {
  fx = await startFixture();
  b = await startFixture();
  dir = await mkdtemp(path.join(tmpdir(), "tidepull-facade-"));
});
after(async () => {
  await fx.close();
  await b.close();
  await rm(dir, { recursive: true, force: true });
});

test("direct download", async () => {
  const info = await extractInfo(`${fx.base}/media/clip.mp4`);
  assert.equal(info.extractor, "direct");
  assert.equal(info.formats[0].filesize, fx.file.length);
  const out = await downloadInfo(info);
  assert.equal(path.basename(out), "clip.mp4");
  same(await readFile(out), fx.file);
});

test("direct download resumes from .part with a Range request", async () => {
  const info = await extractInfo(`${fx.base}/media/clip.mp4`);
  const target = path.join(dir, "resume.mp4");
  await writeFile(target + ".part", fx.file.subarray(0, 300_000));
  const out = await downloadInfo(info, { output: "resume.%(ext)s" });
  same(await readFile(out), fx.file);
  assert.ok(fx.ranges.includes("bytes=300000-"), `ranges seen: ${fx.ranges.join(",")}`);
});

test("generic: finds og:video + og:title", async () => {
  const info = await extractInfo(`${fx.base}/page.html`);
  assert.equal(info.extractor, "generic");
  assert.equal(info.title, "My & Page");
  const out = await downloadInfo(info, { output: "%(title)s.%(ext)s" });
  assert.equal(path.basename(out), "My & Page.mp4");
  same(await readFile(out), fx.file);
});

test("hls: master playlist, format selection, AES-128 with explicit IV", async () => {
  const info = await extractInfo(`${fx.base}/hls/master.m3u8`);
  assert.deepEqual(info.formats.map((f) => f.format_id), ["hls-800", "hls-2000"]);
  const out = await downloadInfo(info, { format: "b", output: "hls-%(format_id)s.%(ext)s" });
  assert.equal(path.basename(out), "hls-hls-2000.ts");
  same(await readFile(out), Buffer.concat(fx.plainSegs));
  const low = await downloadInfo(info, { format: "b[height<=360]", output: "low.%(ext)s" });
  same(await readFile(low), Buffer.concat(fx.plainSegs));
});

test("hls: default IV = media sequence number", async () => {
  const info = await extractInfo(`${fx.base}/hls/noiv.m3u8`);
  const out = await downloadInfo(info, { output: "noiv.%(ext)s" });
  same(await readFile(out), Buffer.concat(fx.noivSegs));
});

test("ffmpeg: merges video-only + audio-only (bv*+ba)", { skip: !findFfmpeg() }, async () => {
  const ff = findFfmpeg()!;
  execFileSync(ff, ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=d=1:s=160x120:r=10", "-an", "-c:v", "mpeg4", path.join(dir, "v.mp4")]);
  execFileSync(ff, ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "sine=d=1", "-c:a", "aac", path.join(dir, "a.m4a")]);
  fx.files.set("/media/v.mp4", await readFile(path.join(dir, "v.mp4")));
  fx.files.set("/media/a.m4a", await readFile(path.join(dir, "a.m4a")));
  const info: Info = {
    id: "merge", title: "merge", extractor: "test", webpage_url: fx.base,
    formats: [
      { format_id: "v", url: `${fx.base}/media/v.mp4`, ext: "mp4", protocol: "https", vcodec: "mpeg4", acodec: "none", height: 120, width: 160 },
      { format_id: "a", url: `${fx.base}/media/a.m4a`, ext: "m4a", protocol: "https", vcodec: "none", acodec: "aac", abr: 128 },
    ],
  };
  const out = await downloadInfo(info, { output: "merged.%(ext)s" });
  const probe = execFileSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type", "-of", "csv=p=0", out]).toString().trim().split("\n").sort();
  assert.deepEqual(probe, ["audio", "video"]);
});

test("events: start -> progress -> finish -> done, all JSON-serializable", async () => {
  const events: TidepullEvent[] = [];
  const g = createTidepull();
  const off = g.on((e) => events.push(e));
  const file = await g.pull(`${fx.base}/media/clip.mp4`, { paths: dir, output: "ev.%(ext)s", overwrite: true });
  off();
  const types = events.map((e) => e.type);
  for (const t of ["extract", "start", "progress", "finish", "done"] as const) assert.ok(types.includes(t), `missing ${t}`);
  assert.ok(types.indexOf("start") < types.indexOf("finish") && types.indexOf("finish") < types.indexOf("done"));
  assert.deepEqual(JSON.parse(JSON.stringify(events)), events);
  const done = events.find((e) => e.type === "done");
  assert.equal(done?.type === "done" && done.file, file);
  // a throwing listener must not break the engine
  g.on(() => {
    throw new Error("boom");
  });
  await g.pull(`${fx.base}/media/clip.mp4`, { paths: dir, output: "ev2.%(ext)s", overwrite: true });
});

test("abort: cancels an in-flight download quickly and keeps the .part for resume", async () => {
  const g = createTidepull();
  const ctl = new AbortController();
  const t0 = Date.now();
  const p = g.pull(`${fx.base}/media/slow.mp4`, { paths: dir, output: "slow.%(ext)s", overwrite: true, signal: ctl.signal });
  setTimeout(() => ctl.abort(), 250);
  await assert.rejects(p, (e: Error) => e.name === "AbortError");
  assert.ok(Date.now() - t0 < 1500, "abort should be prompt");
  assert.ok((await stat(path.join(dir, "slow.mp4.part"))).size > 0, ".part kept");
  // ...and a later run resumes it to a byte-exact file
  const file = await g.pull(`${fx.base}/media/slow.mp4`, { paths: dir, output: "slow.%(ext)s", overwrite: true });
  assert.ok((await readFile(file)).equals(fx.file));
  const pre = createTidepull();
  const c2 = new AbortController();
  c2.abort();
  await assert.rejects(pre.extract(`${fx.base}/media/clip.mp4`, { signal: c2.signal }), (e: Error) => e.name === "AbortError");
});

test("headers: Tidepull never leaks a secret to a cross-origin media host", async () => {
  b.seen.length = 0;
  const g = createTidepull({ http: { headers: { Authorization: "Bearer s3cret", "X-Token": "t0k3n" } } });
  const page = `${fx.base}/page-cross.html?v=${encodeURIComponent(b.base + "/media/clip.mp4")}`;
  const file = await g.pull(page, { paths: dir, output: "cross.%(ext)s", overwrite: true });
  assert.ok((await readFile(file)).equals(b.file), "media came from the other origin");
  const hits = b.seen.filter((r) => r.path === "/media/clip.mp4");
  assert.ok(hits.length >= 2, "HEAD + GET reached b");
  for (const h of hits) {
    assert.equal(h.headers.authorization, undefined);
    assert.equal(h.headers["x-token"], undefined);
  }
  // ...but an explicit headerHosts opt-in does send it
  b.seen.length = 0;
  const g2 = createTidepull({ http: { headers: { "X-Token": "t0k3n" }, headerHosts: ["127.0.0.1"] } });
  await g2.pull(page, { paths: dir, output: "cross2.%(ext)s", overwrite: true });
  assert.ok(b.seen.some((r) => r.headers["x-token"] === "t0k3n"));
});

test("default output name: no redundant \"name [name]\" when title equals id", async () => {
  const info = await extractInfo(`${fx.base}/media/clip.mp4`);
  const out = await g.download(info, { paths: path.join(dir, "default-name") });
  assert.equal(path.basename(out), "clip.mp4");
  // a custom template is never rewritten
  const custom = await g.download(info, { paths: path.join(dir, "default-name"), output: "%(title)s [%(id)s].%(ext)s", overwrite: true });
  assert.equal(path.basename(custom), "clip [clip].mp4");
});

test("limitRate option slows a library download", async () => {
  const info = await extractInfo(`${fx.base}/media/clip.mp4`);
  const t0 = Date.now();
  const out = await g.download(info, { paths: path.join(dir, "limited"), limitRate: 2_000_000 }); // ~1 MiB at 2 MB/s
  assert.ok(Date.now() - t0 >= 400, `took ${Date.now() - t0} ms`);
  assert.ok((await readFile(out)).equals(fx.file));
});
