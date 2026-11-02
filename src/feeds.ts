/**
 * Playlist sources (opt-in: "@boy-offi9-inc/tidepull/feeds"): RSS/Atom feeds with media enclosures, and .m3u playlist files.
 *   import feeds from "@boy-offi9-inc/tidepull/feeds";
 *   createTidepull({ plugins: [feeds] });
 * Each media URL becomes one playlist entry, extracted on its own when it is downloaded.
 */
import { TidepullError } from "./core/errors.ts";
import type { Ctx, Extractor, Playlist, PlaylistEntry } from "./core/types.ts";
import { child, kids, parseXml, type XNode } from "./dash/xml.ts";
import { extOf, stem } from "./extractors/util.ts";
import { definePlugin } from "./plugins.ts";

const MAX_BYTES = 10 * 1024 * 1024;
const MAX_ENTRIES = 10_000;

export interface ParsedList {
  title: string;
  entries: PlaylistEntry[];
}

const isMedia = (type?: string) => !type || /^(audio|video)\//i.test(type) || /octet-stream/i.test(type);

/** The media URL of an RSS item or Atom entry: <enclosure>, an Atom rel="enclosure" link, or Media RSS <media:content>. */
function mediaUrl(item: XNode): string | undefined {
  const candidates = [
    ...kids(item, "enclosure").map((e) => ({ url: e.attrs.url, type: e.attrs.type })),
    ...kids(item, "link").filter((l) => l.attrs.rel === "enclosure").map((l) => ({ url: l.attrs.href, type: l.attrs.type })),
    ...[...kids(item, "content"), ...kids(item, "group").flatMap((g) => kids(g, "content"))].map((c) => ({
      url: c.attrs.url,
      type: c.attrs.type ?? (c.attrs.medium ? `${c.attrs.medium}/` : undefined),
    })),
  ];
  return candidates.find((c) => c.url && isMedia(c.type))?.url;
}

function toEntry(raw: string | undefined, title: string | undefined, base: string, seen: Set<string>): PlaylistEntry | undefined {
  if (!raw) return undefined;
  let url: string;
  try {
    url = new URL(raw.trim(), base).href;
  } catch {
    return undefined;
  }
  if (!/^https?:/.test(url) || seen.has(url)) return undefined;
  seen.add(url);
  return title ? { url, title } : { url };
}

/** Items with a media enclosure from an RSS 2.0, RSS 1.0 or Atom feed. URLs are resolved against `base`. */
export function parseFeed(text: string, base: string): ParsedList {
  const root = parseXml(text);
  let title: string;
  let items: XNode[];
  if (root.name === "rss" || root.name === "RDF") {
    const channel = child(root, "channel") ?? root;
    title = child(channel, "title")?.text ?? "";
    items = [...kids(channel, "item"), ...kids(root, "item")];
  } else if (root.name === "feed") {
    title = child(root, "title")?.text ?? "";
    items = kids(root, "entry");
  } else throw new TidepullError("Not an RSS or Atom feed");
  const seen = new Set<string>();
  const entries: PlaylistEntry[] = [];
  for (const item of items) {
    const entry = toEntry(mediaUrl(item), child(item, "title")?.text.trim(), base, seen);
    if (entry) entries.push(entry);
  }
  return { title: title.trim(), entries };
}

/** Entries of an .m3u playlist file (#EXTINF titles, #PLAYLIST name). Only http(s) URLs are kept. */
export function parseM3u(text: string, base: string): ParsedList {
  let title = "";
  let pending: string | undefined;
  const seen = new Set<string>();
  const entries: PlaylistEntry[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("#PLAYLIST:")) title = line.slice("#PLAYLIST:".length).trim();
    else if (line.startsWith("#EXTINF:")) pending = line.includes(",") ? line.slice(line.indexOf(",") + 1).trim() || undefined : undefined;
    else if (!line.startsWith("#")) {
      const entry = toEntry(line, pending, base, seen);
      if (entry) entries.push(entry);
      pending = undefined;
    }
  }
  return { title, entries };
}

function playlist(extractor: string, url: URL, parsed: ParsedList, ctx: Ctx): Playlist {
  if (!parsed.entries.length) throw new TidepullError(`No media found in this ${extractor === "rss" ? "feed (needs audio or video enclosures)" : "playlist"}`);
  if (parsed.entries.length > MAX_ENTRIES) {
    ctx.log.warn(`Only the first ${MAX_ENTRIES} of ${parsed.entries.length} entries are used`);
    parsed.entries.length = MAX_ENTRIES;
  }
  const id = stem(url.pathname) || url.hostname;
  return { kind: "playlist", id, title: parsed.title || id, extractor, webpage_url: url.href, entries: parsed.entries };
}

export const rssExtractor = {
  name: "rss",
  suitable: (url) => /^(rss|atom|xml)$/.test(extOf(url.pathname)) || /(^|\/)(feed|rss|atom)(\.xml)?\/?$/i.test(url.pathname),
  async extract(url, ctx) {
    const { text, finalUrl } = await ctx.http.text(url.href);
    if (text.length > MAX_BYTES) throw new TidepullError("Feed is too large");
    return playlist("rss", url, parseFeed(text, finalUrl), ctx);
  },
} satisfies Extractor;

export const m3uExtractor = {
  name: "m3u",
  suitable: (url) => extOf(url.pathname) === "m3u",
  async extract(url, ctx) {
    const { text, finalUrl } = await ctx.http.text(url.href);
    if (text.length > MAX_BYTES) throw new TidepullError("Playlist is too large");
    return playlist("m3u", url, parseM3u(text, finalUrl), ctx);
  },
} satisfies Extractor;

export default definePlugin({ name: "feeds", apiVersion: 1, extractors: [rssExtractor, m3uExtractor] });
