import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { RateLimiter, downloadHls, downloadHttp } from "../src/core/downloader.ts";
import { Http } from "../src/core/http.ts";
import { startFixture, type Fixture } from "./fixture.ts";

let fx: Fixture;
let dir: string;
const http = new Http({ retries: 1 });
const base = { http, onProgress: () => {} };

before(async () => {
  fx = await startFixture();
  dir = await mkdtemp(path.join(tmpdir(), "tidepull-dl-"));
});
after(async () => {
  await fx.close();
  await rm(dir, { recursive: true, force: true });
});

test("http: downloads byte-for-byte and reports progress", async () => {
  let last = 0;
  const dest = path.join(dir, "full.bin");
  await downloadHttp(`${fx.base}/media/clip.mp4`, dest, { http, resume: false, onProgress: (p) => (last = p.downloaded) });
  assert.ok((await readFile(dest)).equals(fx.file));
  assert.equal(last, fx.file.length);
});

test("http: resumes from .part with a Range request", async () => {
  const dest = path.join(dir, "resume.bin");
  await writeFile(dest + ".part", fx.file.subarray(0, 300_000));
  await downloadHttp(`${fx.base}/media/clip.mp4`, dest, { ...base, resume: true });
  assert.ok((await readFile(dest)).equals(fx.file));
  assert.ok(fx.ranges.includes("bytes=300000-"), `ranges seen: ${fx.ranges.join(",")}`);
});

test("http: aborting keeps the .part, and the next run completes the file", async () => {
  const dest = path.join(dir, "slow.bin");
  const ctl = new AbortController();
  const p = downloadHttp(`${fx.base}/media/slow.mp4`, dest, { ...base, resume: true, signal: ctl.signal });
  setTimeout(() => ctl.abort(), 250);
  await assert.rejects(p);
  assert.ok((await stat(dest + ".part")).size > 0);
  await downloadHttp(`${fx.base}/media/slow.mp4`, dest, { ...base, resume: true });
  assert.ok((await readFile(dest)).equals(fx.file));
});

test("hls: AES-128 with explicit IV, segments written in order", async () => {
  const dest = path.join(dir, "enc.ts");
  const { ext } = await downloadHls(`${fx.base}/hls/high/index.m3u8`, dest, { ...base, concurrency: 3 });
  assert.equal(ext, "ts");
  assert.ok((await readFile(dest)).equals(Buffer.concat(fx.plainSegs)));
});

test("hls: default IV is the media sequence number", async () => {
  const dest = path.join(dir, "noiv.ts");
  await downloadHls(`${fx.base}/hls/noiv.m3u8`, dest, { ...base, concurrency: 2 });
  assert.ok((await readFile(dest)).equals(Buffer.concat(fx.noivSegs)));
});

test("rate limiter: paces callers to the configured rate and honors abort", async () => {
  const limiter = new RateLimiter(1000);
  const t0 = Date.now();
  await limiter.take(500);
  await limiter.take(500); // 1000 bytes at 1000 B/s
  assert.ok(Date.now() - t0 >= 900, `took ${Date.now() - t0} ms`);

  const ctl = new AbortController();
  const pending = new RateLimiter(10).take(1000, ctl.signal);
  setTimeout(() => ctl.abort(), 50);
  await assert.rejects(pending, (e: Error) => e.name === "AbortError");
});

test("http: a limiter slows the download without changing the bytes", async () => {
  const dest = path.join(dir, "limited.bin");
  const t0 = Date.now();
  await downloadHttp(`${fx.base}/media/clip.mp4`, dest, { ...base, resume: false, limiter: new RateLimiter(1_000_000) }); // ~1 MB in ~1 s
  assert.ok(Date.now() - t0 >= 850, `took ${Date.now() - t0} ms`);
  assert.ok((await readFile(dest)).equals(fx.file));
});

test("hls: a limiter applies to segment writes", async () => {
  const dest = path.join(dir, "limited.ts");
  const t0 = Date.now();
  await downloadHls(`${fx.base}/hls/high/index.m3u8`, dest, { ...base, concurrency: 3, limiter: new RateLimiter(100_000) }); // 100 KB in ~1 s
  assert.ok(Date.now() - t0 >= 850, `took ${Date.now() - t0} ms`);
  assert.ok((await readFile(dest)).equals(Buffer.concat(fx.plainSegs)));
});
