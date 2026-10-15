import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { fillTemplate, parseIsoDuration, parseMpd } from "../src/dash/parse.ts";
import { findFfmpeg } from "../src/core/ffmpeg.ts";
import { parseXml } from "../src/dash/xml.ts";
import dash from "../src/dash/index.ts";
import { createTidepull } from "../src/index.ts";
import { startFixture, type Fixture } from "./fixture.ts";

test("xml: attributes, entities, CDATA, namespaces, self-closing, errors", () => {
  const n = parseXml(`<?xml version="1.0"?><!-- c --><a:Root xmlns:a="x" k='v&amp;w'><Item id="1"/><Item id="2">t&lt;<![CDATA[<raw>]]></Item></a:Root>`);
  assert.equal(n.name, "Root");
  assert.equal(n.attrs.k, "v&w");
  assert.deepEqual(n.children.map((c) => c.attrs.id), ["1", "2"]);
  assert.equal(n.children[1].text, "t<<raw>");
  assert.throws(() => parseXml("<a><b></a>"), /Malformed XML/);
  assert.throws(() => parseXml("<a>"), /unclosed/);
  assert.throws(() => parseXml("<a>" .repeat(100)), /too deep|unclosed/);
});

test("dash: durations, templates", () => {
  assert.equal(parseIsoDuration("PT1H2M3.5S"), 3723.5);
  assert.equal(parseIsoDuration("P1DT0S"), 86400);
  assert.equal(parseIsoDuration("garbage"), undefined);
  assert.equal(fillTemplate("s-$RepresentationID$-$Number%05d$-$Time$-$$.m4s", { RepresentationID: "v1", Bandwidth: 5, Number: 7, Time: 90 }), "s-v1-00007-90-$.m4s");
  assert.throws(() => fillTemplate("$Time$", { RepresentationID: "x", Bandwidth: 1 }), /not defined/);
});

const wrap = (inner: string, attrs = 'type="static" mediaPresentationDuration="PT10S"') =>
  `<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" ${attrs}><BaseURL>media/</BaseURL><Period>${inner}</Period></MPD>`;

test("dash: number-based template, nested BaseURL, SegmentList, single file", () => {
  const m = parseMpd(
    wrap(`
    <AdaptationSet contentType="video" mimeType="video/mp4">
      <Representation id="v1" bandwidth="1000000" width="1280" height="720" frameRate="30000/1001" codecs="avc1.4d401f">
        <SegmentTemplate timescale="1" duration="4" startNumber="0" initialization="i-$RepresentationID$.mp4" media="s-$Number$.m4s"/>
      </Representation>
    </AdaptationSet>
    <AdaptationSet contentType="audio" mimeType="audio/mp4">
      <Representation id="a1" bandwidth="64000" codecs="mp4a.40.2">
        <BaseURL>audio.mp4</BaseURL><SegmentBase indexRange="0-100"/>
      </Representation>
      <Representation id="a2" bandwidth="96000" codecs="mp4a.40.2">
        <SegmentList><Initialization sourceURL="init.mp4"/><SegmentURL media="a-1.m4s"/><SegmentURL media="a-2.m4s"/></SegmentList>
      </Representation>
    </AdaptationSet>`),
    "https://h.test/dir/manifest.mpd",
  );
  const [v, a1, a2] = m.reps;
  assert.equal(v.fragments?.length, 3); // ceil(10 / 4)
  assert.equal(v.fragments?.[0], "https://h.test/dir/media/s-0.m4s");
  assert.equal(v.init, "https://h.test/dir/media/i-v1.mp4");
  assert.equal(v.fps, 29.97);
  assert.equal(a1.single, "https://h.test/dir/media/audio.mp4");
  assert.deepEqual(a2.fragments, ["https://h.test/dir/media/a-1.m4s", "https://h.test/dir/media/a-2.m4s"]);
  assert.equal(a2.init, "https://h.test/dir/media/init.mp4");
});

test("dash: encrypted representations are skipped, live is flagged, bad URLs refused", () => {
  const drm = parseMpd(
    wrap(`<AdaptationSet contentType="video" mimeType="video/mp4"><ContentProtection schemeIdUri="urn:uuid:edef8ba9-79d6-4ace-a3c8-27dcd51d21ed"/>
      <Representation id="e" bandwidth="1"><BaseURL>x.mp4</BaseURL></Representation></AdaptationSet>
      <AdaptationSet contentType="audio" mimeType="audio/mp4"><Representation id="ok" bandwidth="1"><BaseURL>a.mp4</BaseURL></Representation></AdaptationSet>`),
    "https://h.test/m.mpd",
  );
  assert.deepEqual(drm.reps.map((r) => r.id), ["ok"]);
  assert.match(drm.skipped[0], /encrypted/);
  assert.equal(parseMpd(wrap("", 'type="dynamic"'), "https://h.test/m.mpd").dynamic, true);
  const bad = parseMpd(wrap(`<AdaptationSet contentType="video" mimeType="video/mp4"><Representation id="f" bandwidth="1"><BaseURL>file:///etc/passwd</BaseURL></Representation></AdaptationSet>`), "https://h.test/m.mpd");
  assert.equal(bad.reps.length, 0);
  assert.match(bad.skipped[0], /non-http/);
  assert.throws(() => parseMpd("<NotMpd/>", "https://h.test/"), /Not a DASH manifest/);
});

let fx: Fixture;
let dir: string;
before(async () => {
  fx = await startFixture();
  dir = await mkdtemp(path.join(tmpdir(), "tidepull-dash-"));
  const ff = findFfmpeg();
  if (!ff) return;
  const src = path.join(dir, "src");
  await mkdir(src);
  execFileSync(ff, ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=d=6:s=160x120:r=10", "-f", "lavfi", "-i", "sine=d=6",
    "-c:v", "mpeg4", "-c:a", "aac", "-map", "0:v", "-map", "1:a", "-f", "dash", "-seg_duration", "2", "-use_template", "1", "-use_timeline", "1", path.join(src, "manifest.mpd")]);
  for (const f of await readdir(src)) fx.files.set(`/dash/${f}`, await readFile(path.join(src, f)));
});
after(async () => {
  await fx.close();
  await rm(dir, { recursive: true, force: true });
});

test("dash e2e: real ffmpeg DASH (timeline + $Number%05d$): list, download video-only, merge bv*+ba", { skip: !findFfmpeg() }, async () => {
  const g = createTidepull({ plugins: [dash] });
  const info = await g.extract(`${fx.base}/dash/manifest.mpd`);
  assert.equal(info.extractor, "dash");
  assert.deepEqual(info.formats.map((f) => [f.format_id, f.protocol, f.vcodec === "none" ? "audio" : "video"]), [["dash-0", "dash", "video"], ["dash-1", "dash", "audio"]]);
  assert.equal(info.formats[0].fragments?.length, 3);
  assert.deepEqual(g.select(info)?.map((f) => f.format_id), ["dash-0", "dash-1"]);

  const probe = (f: string) =>
    execFileSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type", "-of", "csv=p=0", f]).toString().trim().split("\n").sort();

  const v = await g.download(info, { format: "bv", paths: dir, output: "v.%(ext)s", overwrite: true });
  assert.equal(path.extname(v), ".mp4");
  assert.deepEqual(probe(v), ["video"]);

  const merged = await g.download(info, { paths: dir, output: "m.%(ext)s", overwrite: true });
  assert.deepEqual(probe(merged), ["audio", "video"]);
  assert.ok(fx.seen.some((r) => r.path === "/dash/init-stream0.m4s") && fx.seen.some((r) => r.path === "/dash/chunk-stream1-00003.m4s"));
});
