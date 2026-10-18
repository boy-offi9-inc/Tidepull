import { TidepullError, errMsg } from "../core/errors.ts";
import type { Ctx, Extractor, Format, Info } from "../core/types.ts";
import { extractDirect } from "./direct.ts";
import { extractHls } from "./hls.ts";
import { decodeEntities, extOf } from "./util.ts";

const MEDIA_CT = /^(video|audio)\//;
const HLS_CT = /(mpegurl)/;
const DASH_CT = /dash\+xml/;

function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([a-zA-Z:_-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(tag))) out[m[1].toLowerCase()] = decodeEntities(m[2] ?? m[3] ?? "");
  return out;
}

function findCandidates(html: string, base: string): string[] {
  const found: string[] = [];
  const add = (u?: string) => {
    if (!u) return;
    try {
      found.push(new URL(decodeEntities(u).trim(), base).href);
    } catch {
      /* ignore bad URLs */
    }
  };
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    const a = attrs(m[0]);
    const key = (a.property ?? a.name ?? "").toLowerCase();
    if (/^(og:video(:url|:secure_url)?|twitter:player:stream)$/.test(key)) add(a.content);
  }
  for (const m of html.matchAll(/<(?:video|source)\b[^>]*>/gi)) add(attrs(m[0]).src);
  const flat = html.replace(/\\\//g, "/");
  for (const m of flat.matchAll(/https?:\/\/[^\s"'<>\\]+?\.(?:m3u8|mpd|mp4|webm|mov|m4v|mp3|m4a)(?:\?[^\s"'<>\\]*)?/gi)) add(m[0]);
  return [...new Set(found)].filter((u) => /^https?:/.test(u)).slice(0, 10);
}

async function extractOne(u: URL, ctx: Ctx): Promise<Info> {
  const ex = ctx.extractors.find((e) => e !== genericExtractor && e.suitable(u));
  if (!ex) throw new TidepullError(`no extractor for ${u.href}`);
  return ex.extract(u, ctx);
}

/** Fallback: look at the page itself (media content-type, og:video, <video>, bare media URLs). */
export const genericExtractor: Extractor = {
  name: "generic",
  suitable: () => true,
  async extract(url, ctx) {
    const res = await ctx.http.request(url.href);
    if (!res.ok) {
      await res.body?.cancel();
      throw new TidepullError(`HTTP ${res.status} ${res.statusText} for ${url.href}`);
    }
    const ct = (res.headers.get("content-type") ?? "").toLowerCase();
    if (MEDIA_CT.test(ct) || HLS_CT.test(ct) || DASH_CT.test(ct)) {
      await res.body?.cancel();
      const u = new URL(res.url || url.href);
      if (HLS_CT.test(ct)) return extractHls(u, ctx);
      if (DASH_CT.test(ct)) {
        const dash = ctx.extractors.find((e) => e.name === "dash");
        if (!dash) throw new TidepullError('DASH manifest found; enable it with: import dash from "@boy-offi9-inc/tidepull/dash"; createTidepull({ plugins: [dash] })');
        return dash.extract(u, ctx);
      }
      const info = await extractDirect(u, ctx);
      info.formats[0].ext = extOf(u.pathname) || ct.split("/")[1].split(";")[0];
      return info;
    }

    const html = await res.text();
    const pageUrl = res.url || url.href;
    const candidates = findCandidates(html, pageUrl);
    ctx.log.debug(`generic: ${candidates.length} candidate(s): ${candidates.join(" ")}`);

    const title = decodeEntities(
      /<meta[^>]+property=["']og:title["'][^>]*content=["']([^"']+)["']/i.exec(html)?.[1] ??
        /<meta[^>]+content=["']([^"']+)["'][^>]*property=["']og:title["']/i.exec(html)?.[1] ??
        /<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1] ??
        new URL(pageUrl).hostname,
    ).trim();
    const thumbnail = /<meta[^>]+property=["']og:image["'][^>]*content=["']([^"']+)["']/i.exec(html)?.[1];

    const formats: Format[] = [];
    for (const [i, c] of candidates.entries()) {
      try {
        const info = await extractOne(new URL(c), ctx);
        for (const f of info.formats) {
          formats.push(candidates.length > 1 ? { ...f, format_id: `c${i}-${f.format_id}` } : f);
        }
      } catch (e) {
        ctx.log.debug(`generic: skipped ${c}: ${errMsg(e)}`);
      }
    }
    if (!formats.length) throw new TidepullError(
        `No downloadable media found on ${url.hostname}. This looks like a site that needs its own extractor plugin (see README, Plugins). ` +
          "Built in: direct media files, HLS, DASH and pages that embed them.",
      );

    const id = (await sha(pageUrl)).slice(0, 10);
    return { id, title: title || id, extractor: "generic", webpage_url: pageUrl, thumbnail, formats };
  },
};

async function sha(s: string): Promise<string> {
  const { createHash } = await import("node:crypto");
  return createHash("sha1").update(s).digest("hex");
}
