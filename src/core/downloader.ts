import { createDecipheriv } from "node:crypto";
import { createWriteStream } from "node:fs";
import { rename, rm, stat } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import { TidepullError } from "./errors.ts";
import type { Http } from "./http.ts";
import { isMasterPlaylist, parseMedia, type HlsKey } from "./hls.ts";

export interface Progress {
  downloaded: number;
  total?: number;
  /** total is a guess (HLS: extrapolated from finished segments) */
  estimated?: boolean;
}

/** Caps average throughput at `rate` bytes per second by delaying callers. */
export class RateLimiter {
  private rate: number;
  private start = Date.now();
  private sent = 0;

  constructor(rate: number) {
    this.rate = rate;
  }
  async take(bytes: number, signal?: AbortSignal): Promise<void> {
    this.sent += bytes;
    const wait = this.start + (this.sent / this.rate) * 1000 - Date.now();
    if (wait > 0) await sleep(wait, undefined, { signal });
  }
}

export interface DownloadOpts {
  http: Http;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  limiter?: RateLimiter;
  onProgress: (p: Progress) => void;
}

/** Plain HTTP download. Resumes from `<dest>.part` with Range requests. */
export async function downloadHttp(url: string, dest: string, o: DownloadOpts & { resume: boolean }): Promise<void> {
  const part = dest + ".part";
  let offset = 0;
  if (o.resume) offset = await stat(part).then((s) => s.size, () => 0);

  const headers: Record<string, string> = { "Accept-Encoding": "identity", ...o.headers };
  if (offset > 0) headers.Range = `bytes=${offset}-`;
  const res = await o.http.request(url, { headers, signal: o.signal });

  if (res.status === 416) {
    // Range not satisfiable: the .part is either complete or stale.
    await res.body?.cancel();
    const total = /\*\/(\d+)/.exec(res.headers.get("content-range") ?? "")?.[1];
    if (total && Number(total) === offset) {
      await rename(part, dest);
      return;
    }
    await rm(part, { force: true });
    return downloadHttp(url, dest, { ...o, resume: false });
  }
  if (!res.ok) {
    await res.body?.cancel();
    throw new TidepullError(`HTTP ${res.status} ${res.statusText} for ${url}`);
  }
  if (!res.body) throw new TidepullError(`Empty response body for ${url}`);

  let append = false;
  let total: number | undefined;
  if (res.status === 206 && offset > 0) {
    append = true;
    const m = /bytes (\d+)-\d+\/(\d+)/.exec(res.headers.get("content-range") ?? "");
    total = m ? Number(m[2]) : undefined;
  } else {
    offset = 0; // no usable Range response: start over
    const cl = res.headers.get("content-length");
    total = cl ? Number(cl) : undefined;
  }

  let done = offset;
  const counter = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      done += chunk.length;
      o.onProgress({ downloaded: done, total });
      cb(null, chunk);
    },
  });
  const limiter = o.limiter;
  const throttle = new Transform({
    async transform(chunk: Buffer, _enc, cb) {
      try {
        await limiter?.take(chunk.length, o.signal);
        cb(null, chunk);
      } catch (e) {
        cb(e as Error);
      }
    },
  });
  await pipeline(
    Readable.fromWeb(res.body as unknown as WebReadableStream<Uint8Array>),
    throttle,
    counter,
    createWriteStream(part, { flags: append ? "a" : "w" }),
    { signal: o.signal },
  );
  if (total !== undefined && done !== total) {
    throw new TidepullError(`Incomplete download (${done}/${total} bytes). Re-run to resume.`);
  }
  await rename(part, dest);
}

export interface HlsOpts extends DownloadOpts {
  concurrency: number;
}

/** A fragment to fetch. HLS segments and DASH fragments both reduce to this. */
export interface SegmentRef {
  url: string;
  seq: number;
  key?: HlsKey;
  /** init segment (fMP4); written whenever it changes */
  map?: string;
}

/** Fetches fragments in parallel, writes them in order (bounded memory), decrypts AES-128. Returns the container ext. */
export async function downloadSegments(segments: SegmentRef[], dest: string, o: HlsOpts): Promise<{ ext: "ts" | "mp4" }> {
  if (!segments.length) throw new TidepullError("No segments to download");
  const keyCache = new Map<string, Promise<Buffer>>();
  const getKey = (uri: string) => {
    let p = keyCache.get(uri);
    if (!p) {
      p = o.http.request(uri, { headers: o.headers, signal: o.signal }).then(async (r) => {
        if (!r.ok) throw new TidepullError(`HTTP ${r.status} fetching HLS key`);
        return Buffer.from(await r.arrayBuffer());
      });
      keyCache.set(uri, p);
    }
    return p;
  };

  const fetchBuf = async (u: string): Promise<Buffer> => {
    const r = await o.http.request(u, { headers: o.headers, signal: o.signal });
    if (!r.ok) {
      await r.body?.cancel();
      throw new TidepullError(`HTTP ${r.status} for segment ${u}`);
    }
    return Buffer.from(await r.arrayBuffer());
  };

  const fetchSeg = async (i: number): Promise<Buffer> => {
    const seg = segments[i];
    let buf = await fetchBuf(seg.url);
    if (seg.key) {
      const key = await getKey(seg.key.uri);
      let iv = seg.key.iv;
      if (!iv) {
        iv = Buffer.alloc(16); // default IV = segment sequence number, big-endian
        iv.writeUInt32BE(seg.seq >>> 0, 12);
      }
      const d = createDecipheriv("aes-128-cbc", key, iv);
      buf = Buffer.concat([d.update(buf), d.final()]);
    }
    return buf;
  };

  const part = dest + ".part";
  const out = createWriteStream(part);
  const write = (b: Buffer) => new Promise<void>((res, rej) => out.write(b, (e) => (e ? rej(e) : res())));
  const n = segments.length;
  const inflight: Array<Promise<Buffer> | undefined> = new Array(n);
  const start = (i: number) => {
    inflight[i] = fetchSeg(i);
    inflight[i]!.catch(() => {}); // handled when awaited in order
  };

  let ext: "ts" | "mp4" = "ts";
  let lastMap: string | undefined;
  let bytes = 0;
  try {
    let next = Math.min(Math.max(1, o.concurrency), n);
    for (let i = 0; i < next; i++) start(i);
    for (let i = 0; i < n; i++) {
      o.signal?.throwIfAborted();
      const buf = await inflight[i]!;
      inflight[i] = undefined;
      const map = segments[i].map;
      if (map && map !== lastMap) {
        const init = await fetchBuf(map);
        await write(init);
        bytes += init.length;
        lastMap = map;
        ext = "mp4";
      }
      await o.limiter?.take(buf.length, o.signal);
      await write(buf);
      bytes += buf.length;
      if (next < n) start(next++);
      o.onProgress({ downloaded: bytes, total: Math.round((bytes / (i + 1)) * n), estimated: i + 1 < n });
    }
    await new Promise<void>((res, rej) => out.end((e?: Error | null) => (e ? rej(e) : res())));
  } catch (e) {
    out.destroy();
    await rm(part, { force: true });
    throw e;
  }
  await rename(part, dest);
  return { ext };
}

/** HLS VOD: parse the media playlist, then hand the segments to the shared engine. */
export async function downloadHls(url: string, dest: string, o: HlsOpts): Promise<{ ext: "ts" | "mp4" }> {
  const { text, finalUrl } = await o.http.text(url, { headers: o.headers, signal: o.signal });
  if (isMasterPlaylist(text)) throw new TidepullError("Expected a media playlist, got a master playlist");
  const media = parseMedia(text, finalUrl);
  if (!media.endList) throw new TidepullError("Live HLS streams are not supported yet");
  return downloadSegments(media.segments, dest, o);
}

/** DASH: fragments were already expanded by the extractor (format.init + format.fragments). */
export function downloadDash(f: { init?: string; fragments?: string[] }, dest: string, o: HlsOpts): Promise<{ ext: "ts" | "mp4" }> {
  if (!f.fragments?.length) throw new TidepullError("DASH format has no fragments");
  return downloadSegments(f.fragments.map((url, seq) => ({ url, seq, map: f.init })), dest, o);
}
