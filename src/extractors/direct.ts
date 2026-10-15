import { TidepullError } from "../core/errors.ts";
import type { Ctx, Extractor, Format, Info } from "../core/types.ts";
import { extOf, stem } from "./util.ts";

const VIDEO = new Set(["mp4", "m4v", "webm", "mkv", "mov", "flv", "avi", "ts"]);
const AUDIO = new Set(["mp3", "m4a", "aac", "ogg", "oga", "opus", "wav", "flac"]);

export const directExtractor: Extractor = {
  name: "direct",
  suitable: (url) => VIDEO.has(extOf(url.pathname)) || AUDIO.has(extOf(url.pathname)),
  extract: (url, ctx) => extractDirect(url, ctx),
};

export async function extractDirect(url: URL, ctx: Ctx): Promise<Info> {
  const ext = extOf(url.pathname);
  // Try HEAD first; some servers reject it, so fall back to a 1-byte ranged GET.
  let res = await ctx.http.request(url.href, { method: "HEAD" });
  let size = res.ok ? Number(res.headers.get("content-length")) || undefined : undefined;
  if (!res.ok) {
    res = await ctx.http.request(url.href, { headers: { Range: "bytes=0-0" } });
    await res.body?.cancel();
    if (!res.ok) throw new TidepullError(`HTTP ${res.status} ${res.statusText} for ${url.href}`);
    size = Number(/\/(\d+)$/.exec(res.headers.get("content-range") ?? "")?.[1]) || undefined;
  }
  const audioOnly = AUDIO.has(ext);
  const format: Format = {
    format_id: "http",
    url: res.url || url.href,
    ext,
    protocol: "https",
    vcodec: audioOnly ? "none" : "unknown",
    acodec: "unknown",
    filesize: size,
  };
  const name = stem(url.pathname) || url.hostname;
  return { id: name, title: name, extractor: "direct", webpage_url: url.href, formats: [format] };
}
