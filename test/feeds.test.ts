import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { makeLog } from "../src/core/events.ts";
import { Http } from "../src/core/http.ts";
import { isPlaylist } from "../src/core/pipeline.ts";
import type { Ctx } from "../src/core/types.ts";
import { m3uExtractor, parseFeed, parseM3u, rssExtractor } from "../src/feeds.ts";
import { startFixture, type Fixture } from "./fixture.ts";

const BASE = "https://feed.test/shows/feed.xml";

test("parseFeed: RSS enclosures, Media RSS, relative URLs, CDATA, entities, duplicates and non-media", () => {
  const xml = `<?xml version="1.0"?><rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/"><channel><title> Show &amp; Tell </title>
    <item><title><![CDATA[One <b>]]></title><enclosure url="/a/one.mp3" type="audio/mpeg"/></item>
    <item><title>Two</title><enclosure url="two.mp4" type="video/mp4"/></item>
    <item><title>Cover</title><enclosure url="cover.jpg" type="image/jpeg"/></item>
    <item><title>Dup</title><enclosure url="/a/one.mp3" type="audio/mpeg"/></item>
    <item><title>No media</title></item>
    <item><title>Media RSS</title><media:content url="https://cdn.test/v.mp4" medium="video"/></item>
    <item><title>Group</title><media:group><media:content url="https://cdn.test/g.mp3" type="audio/mpeg"/></media:group></item>
    <item><title>Poster only</title><media:content url="https://cdn.test/p.jpg" medium="image"/></item>
    <item><title>Bad scheme</title><enclosure url="ftp://x.test/a.mp3" type="audio/mpeg"/></item>
  </channel></rss>`;
  const r = parseFeed(xml, BASE);
  assert.equal(r.title, "Show & Tell");
  assert.deepEqual(r.entries.map((e) => e.url), ["https://feed.test/a/one.mp3", "https://feed.test/shows/two.mp4", "https://cdn.test/v.mp4", "https://cdn.test/g.mp3"]);
  assert.equal(r.entries[0].title, "One <b>");
});

test("parseFeed: Atom enclosure links; anything else is a clear error", () => {
  const atom = `<feed xmlns="http://www.w3.org/2005/Atom"><title>A</title>
    <entry><title>E1</title><link rel="alternate" href="/page"/><link rel="enclosure" type="audio/mpeg" href="/e1.mp3"/></entry>
    <entry><title>E2</title><content type="html">text</content></entry></feed>`;
  const r = parseFeed(atom, BASE);
  assert.deepEqual(r.entries, [{ url: "https://feed.test/e1.mp3", title: "E1" }]);
  assert.throws(() => parseFeed("<html><body/></html>", BASE), /Not an RSS or Atom feed/);
  assert.throws(() => parseFeed("<rss><channel>", BASE), /Malformed XML|unclosed/);
});

test("parseM3u: titles, #PLAYLIST, relative URLs; non-http entries are dropped", () => {
  const r = parseM3u("#EXTM3U\n#PLAYLIST: Mix \n#EXTINF:10,First\n/a/1.mp3\n#EXTINF:-1\n2.mp3\nfile:///etc/passwd\nrtsp://x.test/live\n\n# comment\nhttps://cdn.test/3.mp3\n/a/1.mp3\n", "https://h.test/lists/mix.m3u");
  assert.equal(r.title, "Mix");
  assert.deepEqual(r.entries, [
    { url: "https://h.test/a/1.mp3", title: "First" },
    { url: "https://h.test/lists/2.mp3" },
    { url: "https://cdn.test/3.mp3" },
  ]);
});

test("suitable: feeds and .m3u only; HLS (.m3u8) and look-alikes are left alone", () => {
  const rss = (u: string) => rssExtractor.suitable(new URL(u));
  for (const u of ["https://h.test/feed.xml", "https://h.test/podcast.rss", "https://h.test/show/feed", "https://h.test/show/feed/", "https://h.test/atom.xml"]) assert.equal(rss(u), true, u);
  for (const u of ["https://h.test/page.html", "https://h.test/video.mp4", "https://h.test/feedback", "https://h.test/master.m3u8"]) assert.equal(rss(u), false, u);
  assert.equal(m3uExtractor.suitable(new URL("https://h.test/list.m3u")), true);
  assert.equal(m3uExtractor.suitable(new URL("https://h.test/master.m3u8")), false);
});

let fx: Fixture;
before(async () => {
  fx = await startFixture();
});
after(async () => {
  await fx.close();
});
const ctx = (): Ctx => ({ http: new Http({ retries: 1 }), log: makeLog(() => {}), emit: () => {}, extractors: [] });

test("rss extractor: builds a Playlist from a feed over HTTP (image enclosure skipped, duplicate removed)", async () => {
  const r = await rssExtractor.extract(new URL(`${fx.base}/feed.xml`), ctx());
  assert.ok(isPlaylist(r));
  assert.equal(r.title, "My Show");
  assert.deepEqual(r.entries.map((e) => e.title), ["Episode one", "Episode two", "Episode: three?"]);
  assert.ok(r.entries.every((e) => e.url.startsWith(fx.base) && e.url.endsWith(".mp3")));
  const atom = await rssExtractor.extract(new URL(`${fx.base}/atom.xml`), ctx());
  assert.deepEqual(isPlaylist(atom) && atom.entries.map((e) => e.title), ["Atom one", "Atom two"]);
});

test("extractors: an .m3u file becomes a Playlist; empty feeds and non-feeds are clear errors", async () => {
  const m = await m3uExtractor.extract(new URL(`${fx.base}/list.m3u`), ctx());
  assert.ok(isPlaylist(m));
  assert.equal(m.title, "Mix tape");
  assert.deepEqual(m.entries.map((e) => e.title), ["First song", "Second song"]);
  await assert.rejects(rssExtractor.extract(new URL(`${fx.base}/feed-empty.xml`), ctx()), /No media found/);
  await assert.rejects(rssExtractor.extract(new URL(`${fx.base}/not-a-feed.xml`), ctx()), /Not an RSS or Atom feed/);
});
