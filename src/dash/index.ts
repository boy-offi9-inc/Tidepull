/**
 * Opt-in DASH (VOD) support.
 *   import dash from "@boy-offi9-inc/tidepull/dash";
 *   createTidepull({ plugins: [dash] });
 */
import { TidepullError } from "../core/errors.ts";
import type { Ctx, Extractor, Format, Info } from "../core/types.ts";
import { extOf, splitCodecs, stem } from "../extractors/util.ts";
import { definePlugin } from "../plugins.ts";
import { parseMpd } from "./parse.ts";

const MAX_MPD_BYTES = 5 * 1024 * 1024;

const extFor = (mime: string, kind: string): string =>
  mime.includes("webm") ? "webm" : mime.startsWith("audio/") || kind === "audio" ? "m4a" : "mp4";

export const dashExtractor: Extractor = {
  name: "dash",
  suitable: (url) => extOf(url.pathname) === "mpd",
  extract: (url, ctx) => extractDash(url, ctx),
};

export async function extractDash(url: URL, ctx: Ctx): Promise<Info> {
  const { text, finalUrl } = await ctx.http.text(url.href);
  if (text.length > MAX_MPD_BYTES) throw new TidepullError("Manifest is too large");
  const mpd = parseMpd(text, finalUrl);
  if (mpd.dynamic) throw new TidepullError("Live DASH streams are not supported yet");
  if (mpd.periods > 1) ctx.log.warn(`Manifest has ${mpd.periods} periods; only the first is used`);
  for (const s of mpd.skipped) ctx.log.warn(`Skipping representation ${s}`);

  const seen = new Set<string>();
  const uniq = (id: string) => {
    let out = id;
    for (let n = 1; seen.has(out); n++) out = `${id}-${n}`;
    seen.add(out);
    return out;
  };

  const formats: Format[] = [];
  for (const r of mpd.reps) {
    if (r.kind === "other") continue; // subtitles and other tracks are not supported
    const { v, a } = splitCodecs(r.codecs);
    const video = r.kind === "video";
    const f: Format = {
      format_id: uniq(`dash-${r.id}`.replace(/[^\w.-]+/g, "_")),
      url: r.single ?? finalUrl,
      ext: extFor(r.mime, r.kind),
      protocol: r.single ? "https" : "dash",
      width: r.width,
      height: r.height,
      fps: r.fps,
      vcodec: video ? (v ?? "unknown") : "none",
      acodec: video ? "none" : (a ?? "unknown"),
      tbr: Math.round(r.bandwidth / 1000) || undefined,
      abr: !video ? Math.round(r.bandwidth / 1000) || undefined : undefined,
      format_note: r.lang,
    };
    if (!r.single) {
      f.init = r.init;
      f.fragments = r.fragments;
    }
    formats.push(f);
  }
  if (!formats.length) throw new TidepullError(`No downloadable representations in the manifest${mpd.skipped.length ? ` (${mpd.skipped.length} skipped)` : ""}`);

  let name = stem(url.pathname);
  if (/^(manifest|stream|index|master|playlist|main)$/i.test(name)) name = url.pathname.split("/").filter(Boolean).slice(-2, -1)[0] ?? url.hostname;
  return { id: name || url.hostname, title: name || url.hostname, extractor: "dash", webpage_url: url.href, formats };
}

export { parseMpd };

export default definePlugin({ name: "dash", apiVersion: 1, extractors: [dashExtractor] });
