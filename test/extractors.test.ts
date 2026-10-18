import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { directExtractor } from "../src/extractors/direct.ts";
import { genericExtractor } from "../src/extractors/generic.ts";
import { hlsExtractor } from "../src/extractors/hls.ts";
import { buildRegistry } from "../src/extractors/index.ts";
import { Http } from "../src/core/http.ts";
import { makeLog } from "../src/core/events.ts";
import type { Ctx } from "../src/core/types.ts";
import { startFixture, type Fixture } from "./fixture.ts";

let fx: Fixture;
before(async () => {
  fx = await startFixture();
});
after(async () => {
  await fx.close();
});

const ctx = (extractors: Ctx["extractors"] = []): Ctx => ({ http: new Http({ retries: 1 }), log: makeLog(() => {}), emit: () => {}, extractors });

test("direct: reads size via HEAD, id/title from the file name", async () => {
  const info = await directExtractor.extract(new URL(`${fx.base}/media/clip.mp4`), ctx());
  assert.equal(info.formats[0].filesize, fx.file.length);
  assert.equal(info.id, "clip");
  assert.equal(directExtractor.suitable(new URL("https://h.test/x.mp3")), true);
  assert.equal(directExtractor.suitable(new URL("https://h.test/x.html")), false);
});

test("direct: HEAD rejected (405) falls back to a ranged GET", async () => {
  const info = await directExtractor.extract(new URL(`${fx.base}/nohead/clip.mp4`), ctx());
  assert.equal(info.formats[0].filesize, fx.file.length);
});

test("hls: master playlist becomes one format per variant", async () => {
  const info = await hlsExtractor.extract(new URL(`${fx.base}/hls/master.m3u8`), ctx());
  assert.deepEqual(info.formats.map((f) => [f.format_id, f.height, f.tbr, f.protocol]), [["hls-800", 360, 800, "hls"], ["hls-2000", 720, 2000, "hls"]]);
  assert.equal(info.formats[0].vcodec, "avc1.4d401e");
});

test("hls: a media playlist becomes a single format", async () => {
  const info = await hlsExtractor.extract(new URL(`${fx.base}/hls/noiv.m3u8`), ctx());
  assert.deepEqual(info.formats.map((f) => f.format_id), ["hls"]);
});

test("generic: finds og:video and og:title in a page", async () => {
  const info = await genericExtractor.extract(new URL(`${fx.base}/page.html`), ctx(buildRegistry()));
  assert.equal(info.title, "My & Page");
  assert.equal(info.formats.length, 1);
  assert.ok(info.formats[0].url.endsWith("/media/clip.mp4"));
});

test("generic: a page without media explains what to do", async () => {
  await assert.rejects(genericExtractor.extract(new URL(`${fx.base}/empty.html`), ctx(buildRegistry())), /needs its own extractor plugin.*Built in/);
});

test("registry: plugins first, generic always last", () => {
  const plugin = { name: "p", apiVersion: 1, extractors: [{ name: "mine", suitable: () => false, extract: async () => { throw new Error("n/a"); } }] };
  assert.deepEqual(buildRegistry().map((e) => e.name), ["hls", "direct", "generic"]);
  assert.deepEqual(buildRegistry([plugin]).map((e) => e.name), ["mine", "hls", "direct", "generic"]);
});
