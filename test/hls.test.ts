import assert from "node:assert/strict";
import { test } from "node:test";
import { parseAttributes, parseMaster, parseMedia } from "../src/core/hls.ts";

test("hls: attributes, master, media", () => {
  assert.deepEqual(parseAttributes('BANDWIDTH=1,CODECS="a,b",NAME="x"'), { BANDWIDTH: "1", CODECS: "a,b", NAME: "x" });
  const m = parseMaster(
    '#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="en",URI="a/en.m3u8",DEFAULT=YES\n#EXT-X-STREAM-INF:BANDWIDTH=1000,RESOLUTION=1280x720,FRAME-RATE=30,AUDIO="aud"\nv/720.m3u8\n',
    "https://h.test/x/master.m3u8",
  );
  assert.equal(m.variants[0].url, "https://h.test/x/v/720.m3u8");
  assert.equal(m.variants[0].height, 720);
  assert.equal(m.variants[0].fps, 30);
  assert.equal(m.renditions[0].uri, "https://h.test/x/a/en.m3u8");

  const media = parseMedia(
    '#EXTM3U\n#EXT-X-MEDIA-SEQUENCE:10\n#EXT-X-MAP:URI="init.mp4"\n#EXT-X-KEY:METHOD=AES-128,URI="k"\n#EXTINF:2.5,\ns1.m4s\n#EXT-X-KEY:METHOD=NONE\n#EXTINF:2,\ns2.m4s\n#EXT-X-ENDLIST\n',
    "https://h.test/p/i.m3u8",
  );
  assert.equal(media.endList, true);
  assert.deepEqual(media.segments.map((s) => s.seq), [10, 11]);
  assert.equal(media.segments[0].key?.uri, "https://h.test/p/k");
  assert.equal(media.segments[1].key, undefined);
  assert.equal(media.segments[0].map, "https://h.test/p/init.mp4");
  assert.throws(() => parseMedia("#EXTM3U\n#EXT-X-KEY:METHOD=SAMPLE-AES,URI=\"k\"\n#EXTINF:1,\na.ts\n", "https://h.test/"), /Unsupported HLS encryption/);
});

test("hls: byte-range parsing — explicit offset, implicit continuation, map range", () => {
  const media = parseMedia(
    '#EXTM3U\n#EXT-X-MAP:URI="init.mp4",BYTERANGE="120@40"\n#EXTINF:1,\n#EXT-X-BYTERANGE:500@1000\na.mp4\n#EXTINF:1,\n#EXT-X-BYTERANGE:600\na.mp4\n#EXTINF:1,\nb.mp4\n#EXTINF:1,\n#EXT-X-BYTERANGE:700\na.mp4\n#EXT-X-ENDLIST\n',
    "https://h.test/p/i.m3u8",
  );
  assert.deepEqual(media.segments[0].range, { start: 1000, length: 500 });
  assert.deepEqual(media.segments[1].range, { start: 1500, length: 600 }); // implicit: prev end + 1
  assert.equal(media.segments[2].range, undefined); // unranged URI resets the subsequence
  assert.deepEqual(media.segments[3].range, { start: 0, length: 700 }); // new resource => subsequence restarts at 0
  assert.deepEqual(media.segments[0].mapRange, { start: 40, length: 120 });
  assert.deepEqual(media.segments[2].mapRange, { start: 40, length: 120 }); // map persists across segments
  assert.throws(() => parseMedia("#EXTM3U\n#EXT-X-BYTERANGE:0\na.ts\n", "https://h.test/"), /Invalid EXT-X-BYTERANGE/);
});
