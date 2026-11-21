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

export const dashExtractor = {
  name: "dash",
  suitable: (url) => extOf(url.pathname) === "mpd",
  extract: (url, ctx) => extractDash(url, ctx),
} satisfies Extractor;

export async function extractDash(url: URL, ctx: Ctx): Promise<Info> {
  const { text, finalUrl } = await ctx.http.text(url.href);
  if (text.length > MAX_MPD_BYTES) throw new TidepullError("Manifest is too large");
  const mpd = parseMpd(text, finalUrl);
  if (mpd.dynamic) throw new TidepullError("Live DASH streams are not supported yet");
  for (const s of mpd.skipped) ctx.log.warn(`Skipping representation ${s}`);

  // Multi-period manifests repeat the same representations in every Period;
  // merge them into one downloadable stream by concatenating the fragments in
  // period order. Representations that do not exist in every period (or whose
  // init/codec identity changes mid-stream) cannot be merged and are skipped.
  const reps = mergePeriods(mpd.reps, mpd.periods, ctx);

  const seen = new Set<string>();
  const uniq = (id: string) => {
    let out = id;
    for (let n = 1; seen.has(out); n++) out = `${id}-${n}`;
    seen.add(out);
    return out;
  };

  const formats: Format[] = [];
  for (const r of reps) {
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

/** Merges the same representation across periods: fragments concatenated in order, init from period 0. */
function mergePeriods(reps: import("./parse.ts").DashRep[], periods: number, ctx: Ctx): import("./parse.ts").DashRep[] {
  if (periods <= 1) return reps;
  const byId = new Map<string, import("./parse.ts").DashRep[]>();
  for (const r of reps) {
    const list = byId.get(r.id) ?? [];
    list.push(r);
    byId.set(r.id, list);
  }
  const merged: import("./parse.ts").DashRep[] = [];
  for (const [, list] of byId) {
    if (list.length !== periods) {
      ctx.log.warn(`Skipping representation ${list[0].id}: it does not appear in every period (${list.length}/${periods})`);
      continue;
    }
    list.sort((a, b) => a.period - b.period);
    const [first, ...rest] = list;
    // identity must stay stable across the stream (same codecs/mime/bandwidth class)
    if (rest.some((r) => r.mime !== first.mime || r.codecs !== first.codecs)) {
      ctx.log.warn(`Skipping representation ${first.id}: codecs or mime type change between periods`);
      continue;
    }
    // whole-file (single) representations cannot be concatenated
    if (first.single) {
      ctx.log.warn(`Skipping representation ${first.id}: whole-file representations cannot span periods`);
      continue;
    }
    const fragments: string[] = [];
    for (const r of list) {
      if (!r.fragments?.length || !r.init) {
        ctx.log.warn(`Skipping representation ${first.id}: a period has no fragment list`);
        fragments.length = 0;
        break;
      }
      fragments.push(...r.fragments);
    }
    if (!fragments.length) continue;
    merged.push({ ...first, fragments, init: first.init });
  }
  return merged;
}

export { parseMpd };

export default definePlugin({ name: "dash", apiVersion: 1, extractors: [dashExtractor] });
