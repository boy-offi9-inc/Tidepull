import assert from "node:assert/strict";
import { test } from "node:test";
import { selectFormats } from "../src/core/selector.ts";
import type { Format } from "../src/core/types.ts";

const F = (o: Partial<Format> & { format_id: string }): Format => ({
  url: "u", ext: "mp4", protocol: "https", vcodec: "none", acodec: "none", ...o,
});
const formats: Format[] = [
  F({ format_id: "v360", vcodec: "avc1", height: 360, tbr: 400 }),
  F({ format_id: "v720", vcodec: "avc1", height: 720, tbr: 1500 }),
  F({ format_id: "v1080", vcodec: "avc1", height: 1080, tbr: 3000, filesize: 50 * 1024 * 1024 }),
  F({ format_id: "a128", acodec: "mp4a", abr: 128, ext: "m4a" }),
  F({ format_id: "a48", acodec: "mp4a", abr: 48, ext: "m4a" }),
  F({ format_id: "m360", vcodec: "avc1", acodec: "mp4a", height: 360, tbr: 600 }),
];
const ids = (sel: string) => selectFormats(sel, formats)?.map((f) => f.format_id);

test("selector: merge, filters, fallback", () => {
  assert.deepEqual(ids("bv*+ba"), ["v1080", "a128"]);
  assert.deepEqual(ids("bv*[height<=720]+ba"), ["v720", "a128"]);
  assert.deepEqual(ids("bv[height<=360]+ba"), ["v360", "a128"]);
  assert.deepEqual(ids("b"), ["m360"]);
  assert.deepEqual(ids("wa"), ["a48"]);
  assert.deepEqual(ids("ba/b"), ["a128"]);
  assert.deepEqual(ids("nope/b"), ["m360"]);
  assert.deepEqual(ids("v720"), ["v720"]);
  assert.deepEqual(ids("bv[filesize<?10M]"), ["v720"]);
  assert.deepEqual(ids("(bv[height>2000]/bv[height<=360])+ba"), ["v360", "a128"]);
  assert.equal(ids("bv[height>2000]"), undefined);
  assert.equal(ids("bv*+nope"), undefined);
});

test("selector: invalid syntax is a usage error", () => {
  for (const bad of ["bv*+", "(bv", "bv[height<=]", "bv[x", "a b)"]) {
    assert.throws(() => selectFormats(bad, formats), (e: Error & { exitCode?: number }) => e.exitCode === 2, bad);
  }
});
