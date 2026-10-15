import { TidepullError } from "../core/errors.ts";
import { isMasterPlaylist, parseMaster } from "../core/hls.ts";
import type { Ctx, Extractor, Format, Info } from "../core/types.ts";
import { extOf, splitCodecs, stem } from "./util.ts";

export const hlsExtractor: Extractor = {
  name: "hls",
  suitable: (url) => extOf(url.pathname) === "m3u8",
  extract: (url, ctx) => extractHls(url, ctx),
};

export async function extractHls(url: URL, ctx: Ctx): Promise<Info> {
  const { text, finalUrl } = await ctx.http.text(url.href);
  if (!text.trimStart().startsWith("#EXTM3U")) throw new TidepullError(`Not an HLS playlist: ${url.href}`);

  const formats: Format[] = [];
  if (isMasterPlaylist(text)) {
    const master = parseMaster(text, finalUrl);
    const audioGroups = new Map<string, boolean>();
    for (const r of master.renditions) if (r.type === "AUDIO" && r.uri) audioGroups.set(r.groupId, true);
    const seen = new Set<string>();
    const uniq = (id: string) => {
      let out = id;
      for (let n = 1; seen.has(out); n++) out = `${id}-${n}`;
      seen.add(out);
      return out;
    };

    let audioCodec: string | undefined;
    for (const v of master.variants) {
      const { v: vc, a: ac } = splitCodecs(v.codecs);
      // Variant points at an external audio group and lists no audio codec => video-only stream.
      const external = !!v.audioGroup && audioGroups.has(v.audioGroup) && !ac && !!v.codecs;
      if (ac) audioCodec ??= ac;
      formats.push({
        format_id: uniq(`hls-${Math.round(v.bandwidth / 1000)}`),
        url: v.url,
        ext: "ts",
        protocol: "hls",
        width: v.width,
        height: v.height,
        fps: v.fps,
        vcodec: vc ?? "unknown",
        acodec: external ? "none" : (ac ?? "unknown"),
        tbr: Math.round(v.bandwidth / 1000) || undefined,
      });
    }
    for (const r of master.renditions) {
      if (r.type !== "AUDIO" || !r.uri) continue;
      formats.push({
        format_id: uniq(`hls-audio-${r.groupId}-${r.name}`.replace(/\W+/g, "_")),
        url: r.uri,
        ext: "ts",
        protocol: "hls",
        vcodec: "none",
        acodec: audioCodec ?? "unknown",
        format_note: [r.name, r.language].filter(Boolean).join(" "),
      });
    }
    if (!formats.length) throw new TidepullError("Master playlist has no variants");
  } else {
    formats.push({ format_id: "hls", url: finalUrl, ext: "ts", protocol: "hls", vcodec: "unknown", acodec: "unknown" });
  }

  let name = stem(url.pathname);
  if (/^(index|master|playlist|manifest|stream|main)$/i.test(name)) {
    name = url.pathname.split("/").filter(Boolean).slice(-2, -1)[0] ?? url.hostname;
  }
  return { id: name || url.hostname, title: name || url.hostname, extractor: "hls", webpage_url: url.href, formats };
}
