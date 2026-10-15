import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { directExtractor } from "../src/extractors/direct.ts";
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
