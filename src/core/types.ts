import type { Emit, Log } from "./events.ts";
import type { Http } from "./http.ts";

export type Protocol = "https" | "hls" | "dash";

/** One downloadable stream. */
export interface Format {
  format_id: string;
  url: string;
  ext: string;
  protocol: Protocol;
  width?: number;
  height?: number;
  fps?: number;
  /** "none" = no video track. "unknown" = present but codec not known. */
  vcodec: string;
  /** "none" = no audio track. */
  acodec: string;
  /** total bitrate, kbit/s */
  tbr?: number;
  /** audio bitrate, kbit/s */
  abr?: number;
  filesize?: number;
  format_note?: string;
  http_headers?: Record<string, string>;
  /** dash: init segment URL (written first) */
  init?: string;
  /** dash: media segment URLs in order */
  fragments?: string[];
}

/** What every extractor returns (the "info dict"). */
export interface Info {
  id: string;
  title: string;
  extractor: string;
  webpage_url: string;
  formats: Format[];
  thumbnail?: string;
  duration?: number;
  uploader?: string;
  upload_date?: string;
  [key: string]: unknown;
}

/** Passed to every extractor call. */
export interface Ctx {
  http: Http;
  log: Log;
  emit: Emit;
  /** Ordered extractor list (plugins, built-ins, generic last). */
  extractors: readonly Extractor[];
  signal?: AbortSignal;
}

/** The extractor contract. One file per site. */
export interface Extractor {
  readonly name: string;
  suitable(url: URL): boolean;
  extract(url: URL, ctx: Ctx): Promise<Info>;
}
