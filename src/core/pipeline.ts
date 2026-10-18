import { mkdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { downloadDash, downloadHls, downloadHttp, type Progress } from "./downloader.ts";
import { TidepullError } from "./errors.ts";
import { findFfmpeg, mergeStreams, remux } from "./ffmpeg.ts";
import { Meter } from "./meter.ts";
import { selectFormats } from "./selector.ts";
import { renderTemplate } from "./template.ts";
import type { Ctx, Format, Info } from "./types.ts";

export const DEFAULT_OUTPUT = "%(title)s [%(id)s].%(ext)s";

export interface DownloadOptions {
  /** format selector, default "bv*+ba/b" */
  format: string;
  /** output template. Default: "%(title)s [%(id)s].%(ext)s", or just the title when the id is identical (typical for direct files) */
  output?: string;
  /** base directory */
  paths: string;
  /** resume from .part files */
  resume: boolean;
  overwrite: boolean;
  /** HLS segments fetched in parallel */
  concurrency: number;
  /** container used when merging video+audio */
  mergeFormat: string;
  remuxVideo?: string;
  /** ffmpeg binary or its directory (default: search PATH) */
  ffmpeg?: string;
  /** extra request headers for the media downloads */
  headers: Record<string, string>;
}

export async function extractInfo(rawUrl: string, ctx: Ctx): Promise<Info> {
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`);
  } catch {
    throw new TidepullError(`Invalid URL: ${rawUrl}`, 2);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new TidepullError(`Unsupported URL scheme: ${url.protocol}`, 2);
  const ex = ctx.extractors.find((e) => e.suitable(url));
  if (!ex) throw new TidepullError(`No extractor can handle ${url.href}`);
  ctx.emit({ type: "extract", extractor: ex.name, url: url.href });
  const info = await ex.extract(url, ctx);
  if (!info.formats?.length) throw new TidepullError(`Extractor "${ex.name}" returned no formats`);
  return info;
}

/** Drops undefined keys so events serialize cleanly. */
const compact = <T extends object>(o: T): T => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;

const scalars = (o: object): Record<string, unknown> =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => ["string", "number", "boolean"].includes(typeof v)));

/** Selects formats per opts.format, downloads them, merges/remuxes with ffmpeg if needed. Returns the final file path. */
export async function downloadInfo(info: Info, opts: DownloadOptions, ctx: Ctx): Promise<string> {
  const chosen = selectFormats(opts.format, info.formats);
  if (!chosen) throw new TidepullError(`Requested format is not available: ${opts.format} (try --list-formats)`);

  const ffmpeg = findFfmpeg(opts.ffmpeg);
  const merging = chosen.length > 1;
  if (merging && !ffmpeg) {
    throw new TidepullError(`ffmpeg is required to merge ${chosen.map((f) => f.format_id).join("+")}. Install it, or pick one format (-f b).`);
  }

  const predictedExt = merging ? opts.mergeFormat : chosen[0].ext;
  const fields = {
    ...scalars(info),
    ...scalars(chosen[0]),
    format_id: chosen.map((f) => f.format_id).join("+"),
    resolution: chosen[0].height ? `${chosen[0].width ?? "?"}x${chosen[0].height}` : "audio only",
    ext: predictedExt,
  };
  // Default name: just the title when it equals the id (direct files).
  const template = opts.output ?? (String(info.title) === String(info.id) ? "%(title)s.%(ext)s" : DEFAULT_OUTPUT);
  let target = path.resolve(opts.paths, renderTemplate(template, fields));
  await mkdir(path.dirname(target), { recursive: true });

  const exists = await stat(target).then(() => true, () => false);
  if (exists && !opts.overwrite) {
    ctx.log.info("download", `${target} has already been downloaded`);
    return target;
  }

  const base = target.slice(0, target.length - path.extname(target).length);

  const fetchOne = async (f: Format, dest: string): Promise<string> => {
    ctx.emit({ type: "start", format_id: f.format_id, dest });
    const meter = new Meter();
    const t0 = Date.now();
    let last = 0;
    let bytes = 0;
    const onProgress = (p: Progress) => {
      bytes = p.downloaded;
      const speed = meter.push(p.downloaded);
      const now = Date.now();
      if (now - last < 100) return;
      last = now;
      const eta = speed && p.total ? (p.total - p.downloaded) / speed : undefined;
      ctx.emit(compact({ type: "progress" as const, format_id: f.format_id, ...p, speed, eta }));
    };
    const common = { http: ctx.http, headers: { ...f.http_headers, ...opts.headers }, signal: ctx.signal, onProgress };
    let ext = f.ext;
    if (f.protocol === "hls") ({ ext } = await downloadHls(f.url, dest, { ...common, concurrency: opts.concurrency }));
    else if (f.protocol === "dash") ({ ext } = await downloadDash(f, dest, { ...common, concurrency: opts.concurrency }));
    else await downloadHttp(f.url, dest, { ...common, resume: opts.resume });
    const seconds = (Date.now() - t0) / 1000;
    const avg = seconds > 0 ? (bytes - (meter.startBytes ?? 0)) / seconds : undefined;
    ctx.emit(compact({ type: "finish" as const, format_id: f.format_id, bytes, seconds, speed: avg }));
    return ext;
  };

  if (!merging) {
    const ext = await fetchOne(chosen[0], target);
    if (ext !== path.extname(target).slice(1)) {
      const fixed = `${base}.${ext}`; // the real container can differ from the predicted one (e.g. fMP4 HLS)
      await rename(target, fixed);
      target = fixed;
    }
  } else {
    const tmp: string[] = [];
    try {
      for (const f of chosen.slice(0, 2)) {
        const dest = `${base}.f${f.format_id.replace(/\W+/g, "_")}.${f.ext}`;
        tmp.push(dest);
        await fetchOne(f, dest);
      }
      // video stream first, audio second
      const [v, a] = chosen[0].vcodec !== "none" ? [tmp[0], tmp[1]] : [tmp[1], tmp[0]];
      ctx.emit({ type: "merge", output: target });
      await mergeStreams(ffmpeg!, v, a, target);
    } catch (e) {
      await rm(target, { force: true });
      throw e;
    } finally {
      await Promise.all(tmp.map((t) => rm(t, { force: true })));
    }
  }

  if (opts.remuxVideo && path.extname(target).slice(1) !== opts.remuxVideo) {
    if (!ffmpeg) throw new TidepullError("ffmpeg is required for --remux-video");
    const out = `${base}.${opts.remuxVideo}`;
    ctx.emit({ type: "remux", output: out });
    await remux(ffmpeg, target, out);
    await rm(target, { force: true });
    target = out;
  }
  return target;
}
