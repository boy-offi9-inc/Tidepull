import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import feeds from "../src/feeds.ts";
import { createTidepull, isPlaylist, type TidepullEvent } from "../src/index.ts";
import { parseItems, playlistFields, pullAll, resolveItems } from "../src/playlist.ts";
import { startFixture, type Fixture } from "./fixture.ts";

const exit2 = (e: Error & { exitCode?: number }) => e.exitCode === 2;

test("parseItems: ranges, open ends, order, duplicates, out-of-range", () => {
  assert.deepEqual(parseItems(undefined, 3), [1, 2, 3]);
  assert.deepEqual(parseItems("  ", 3), [1, 2, 3]);
  assert.deepEqual(parseItems("1-3,7,10-", 12), [1, 2, 3, 7, 10, 11, 12]);
  assert.deepEqual(parseItems("3,1,3,2-3", 5), [3, 1, 2]);
  assert.deepEqual(parseItems("-2", 5), [1, 2]);
  assert.deepEqual(parseItems("2-9", 4), [2, 3, 4]);
  assert.deepEqual(parseItems("4-", 3), []);
  assert.deepEqual(parseItems("5", 3), []);
  for (const bad of ["abc", "1-x", "0", "0-2", "1,x"]) assert.throws(() => parseItems(bad, 5), exit2, bad);
});

let fx: Fixture;
let other: Fixture;
let dir: string;
before(async () => {
  fx = await startFixture();
  other = await startFixture();
  dir = await mkdtemp(path.join(tmpdir(), "tidepull-playlist-"));
});
after(async () => {
  await fx.close();
  await other.close();
  await rm(dir, { recursive: true, force: true });
});

const same = async (file: string, buf: Buffer) => assert.ok((await readFile(file)).equals(buf), `${file} differs`);

test("resolve returns a Playlist; extract refuses it with a helpful error", async () => {
  const tp = createTidepull({ plugins: [feeds] });
  const r = await tp.resolve(`${fx.base}/feed.xml`);
  assert.ok(isPlaylist(r));
  assert.equal(r.entries.length, 3);
  await assert.rejects(tp.extract(`${fx.base}/feed.xml`), /is a playlist \(3 items\)/);
  const single = await tp.resolve(`${fx.base}/media/clip.mp4`);
  assert.ok(!isPlaylist(single));
});

test("pullAll: item selection, numbered names, feed titles, events", async () => {
  const tp = createTidepull({ plugins: [feeds] });
  const events: TidepullEvent[] = [];
  tp.on((e) => events.push(e));
  const files = await pullAll(tp, `${fx.base}/feed.xml`, { paths: path.join(dir, "sel"), items: "2-3" });
  assert.deepEqual(files.map((f) => path.basename(f)), ["02 - Episode two.mp3", "03 - Episode_ three_.mp3"]);
  await same(files[0], fx.eps[1]);
  await same(files[1], fx.eps[2]);
  assert.deepEqual(events.find((e) => e.type === "playlist"), { type: "playlist", title: "My Show", count: 3, selected: 2 });
  assert.deepEqual(events.flatMap((e) => (e.type === "item" ? [[e.index, e.position, e.total]] : [])), [[2, 1, 2], [3, 2, 2]]);
});

test("pullAll: playlist fields work in custom templates; a single URL is just one file", async () => {
  const tp = createTidepull({ plugins: [feeds] });
  const [f] = await pullAll(tp, `${fx.base}/feed.xml`, { paths: path.join(dir, "tpl"), items: "2", output: "%(playlist)s/%(playlist_index)03d of %(playlist_count)s.%(ext)s" });
  assert.equal(path.relative(path.join(dir, "tpl"), f), path.join("My Show", "002 of 3.mp3"));
  const [one] = await pullAll(tp, `${fx.base}/media/clip.mp4`, { paths: path.join(dir, "single") });
  assert.equal(path.basename(one), "clip.mp4");
  assert.deepEqual(playlistFields({ index: 1, position: 1, total: 1 }), {});
});

test("pullAll: a failing item is thrown by default, or reported and skipped with onError", async () => {
  const tp = createTidepull({ plugins: [feeds] });
  await assert.rejects(pullAll(tp, `${fx.base}/feed-broken.xml`, { paths: path.join(dir, "b1") }), /404/);
  const errors: string[] = [];
  const files = await pullAll(tp, `${fx.base}/feed-broken.xml`, { paths: path.join(dir, "b2"), onError: (e, item) => errors.push(`${item.index}: ${e.message}`) });
  assert.deepEqual(files.map((f) => path.basename(f)), ["01 - Good one.mp3", "03 - Good two.mp3"]);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /^2: .*404/);
});

test("playlist entries never receive secret headers, even on another origin", async () => {
  fx.seen.length = 0;
  other.seen.length = 0;
  const tp = createTidepull({ plugins: [feeds], http: { headers: { "X-Token": "t0k3n" } } });
  const files = await pullAll(tp, `${fx.base}/feed-cross.xml?m=${encodeURIComponent(other.base)}`, { paths: path.join(dir, "cross") });
  assert.equal(files.length, 2);
  assert.ok(fx.seen.some((r) => r.path === "/feed-cross.xml" && r.headers["x-token"] === "t0k3n"), "the URL you passed is trusted");
  const hits = other.seen.filter((r) => r.path.startsWith("/media/"));
  assert.ok(hits.length >= 2);
  for (const h of hits) assert.equal(h.headers["x-token"], undefined, "entries found inside a feed are not trusted");
});

test("a feed at an unusual URL is recognised by its content type", async () => {
  const r = await createTidepull({ plugins: [feeds] }).resolve(`${fx.base}/odd/podcast`);
  assert.ok(isPlaylist(r));
  assert.equal(r.entries.length, 2);
  await assert.rejects(createTidepull().resolve(`${fx.base}/odd/podcast`), /tidepull\/feeds/);
});

test("audio without a file extension gets the right extension and is audio-only", async () => {
  const tp = createTidepull();
  const info = await tp.extract(`${fx.base}/noext/audio`);
  assert.equal(info.formats[0].ext, "mp3");
  assert.equal(info.formats[0].vcodec, "none");
  const file = await tp.download(info, { paths: path.join(dir, "noext") });
  assert.equal(path.basename(file), "audio.mp3");
  await same(file, fx.eps[0]);
});

test("resolveItems: already-resolved sources work, and cancellation stops the iteration", async () => {
  const tp = createTidepull({ plugins: [feeds] });
  const playlist = await tp.resolve(`${fx.base}/feed.xml`);
  const seen: number[] = [];
  for await (const item of resolveItems(tp, playlist, { items: "3,1" })) seen.push(item.index);
  assert.deepEqual(seen, [3, 1]);
  const ctl = new AbortController();
  ctl.abort();
  await assert.rejects(pullAll(tp, `${fx.base}/feed.xml`, { paths: path.join(dir, "aborted"), signal: ctl.signal }), (e: Error) => e.name === "AbortError");
});
