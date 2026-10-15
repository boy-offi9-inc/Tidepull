/** Static (VOD) MPEG-DASH: SegmentTemplate (number / timeline), SegmentList, single-file SegmentBase. No DRM, no live. */
import { TidepullError } from "../core/errors.ts";
import { child, kids, parseXml, type XNode } from "./xml.ts";

export interface DashRep {
  id: string;
  kind: "video" | "audio" | "other";
  mime: string;
  codecs?: string;
  bandwidth: number;
  width?: number;
  height?: number;
  fps?: number;
  lang?: string;
  /** fragmented: init segment + media segments */
  init?: string;
  fragments?: string[];
  /** whole-file representation (SegmentBase / plain BaseURL) */
  single?: string;
}
export interface DashManifest {
  reps: DashRep[];
  dynamic: boolean;
  periods: number;
  skipped: string[];
}

const MAX_FRAGMENTS = 50_000;

export function parseIsoDuration(s?: string): number | undefined {
  if (!s) return undefined;
  const m = /^P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(s);
  if (!m) return undefined;
  return Number(m[3] ?? 0) * 86400 + Number(m[4] ?? 0) * 3600 + Number(m[5] ?? 0) * 60 + Number(m[6] ?? 0);
}

function parseRate(s?: string): number | undefined {
  if (!s) return undefined;
  const [a, b] = s.split("/").map(Number);
  const v = b ? a / b : a;
  return Number.isFinite(v) ? Math.round(v * 100) / 100 : undefined;
}

function resolve(base: string, rel?: string): string {
  const u = new URL(rel?.trim() ? rel.trim() : ".", base);
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new TidepullError(`Refusing non-http(s) URL in manifest: ${u.protocol}`);
  return u.href;
}

/** $RepresentationID$, $Number$, $Bandwidth$, $Time$ (+ %0Nd width), $$ */
export function fillTemplate(tpl: string, v: { RepresentationID: string; Bandwidth: number; Number?: number; Time?: number }): string {
  return tpl.replace(/\$(RepresentationID|Number|Bandwidth|Time)(?:%0(\d+)d)?\$|\$\$/g, (m, key?: keyof typeof v, width?: string) => {
    if (m === "$$") return "$";
    const val = v[key as keyof typeof v];
    if (val === undefined) throw new TidepullError(`Manifest template uses $${key}$ where it is not defined`);
    const s = String(val);
    return width ? s.padStart(Number(width), "0") : s;
  });
}

export function parseMpd(text: string, manifestUrl: string): DashManifest {
  const root = parseXml(text);
  if (root.name !== "MPD") throw new TidepullError("Not a DASH manifest (root element is not MPD)");
  const dynamic = (root.attrs.type ?? "static") === "dynamic";
  const periods = kids(root, "Period");
  const out: DashManifest = { reps: [], dynamic, periods: periods.length, skipped: [] };
  if (dynamic || !periods.length) return out;

  const period = periods[0];
  const mpdDur = parseIsoDuration(root.attrs.mediaPresentationDuration);
  const periodDur = parseIsoDuration(period.attrs.duration) ?? (periods.length === 1 ? mpdDur : undefined);
  const baseP = resolve(resolve(manifestUrl, child(root, "BaseURL")?.text), child(period, "BaseURL")?.text);

  for (const aset of kids(period, "AdaptationSet")) {
    const baseA = resolve(baseP, child(aset, "BaseURL")?.text);
    for (const rep of kids(aset, "Representation")) {
      const id = rep.attrs.id ?? String(out.reps.length);
      const mime = rep.attrs.mimeType ?? aset.attrs.mimeType ?? "";
      const ctype = aset.attrs.contentType ?? rep.attrs.contentType ?? mime.split("/")[0];
      const kind = ctype === "video" ? "video" : ctype === "audio" ? "audio" : "other";
      if (child(aset, "ContentProtection") || child(rep, "ContentProtection")) {
        out.skipped.push(`${id}: encrypted (ContentProtection), cannot be downloaded`);
        continue;
      }
      try {
        const baseR = resolve(baseA, child(rep, "BaseURL")?.text);
        const bandwidth = Number(rep.attrs.bandwidth ?? 0);
        const r: DashRep = {
          id, kind, mime,
          codecs: rep.attrs.codecs ?? aset.attrs.codecs,
          bandwidth,
          width: Number(rep.attrs.width ?? aset.attrs.width) || undefined,
          height: Number(rep.attrs.height ?? aset.attrs.height) || undefined,
          fps: parseRate(rep.attrs.frameRate ?? aset.attrs.frameRate),
          lang: aset.attrs.lang,
        };
        const vars = { RepresentationID: id, Bandwidth: bandwidth };

        const tplNode = child(rep, "SegmentTemplate") ?? child(aset, "SegmentTemplate");
        const listNode = child(rep, "SegmentList") ?? child(aset, "SegmentList");
        if (tplNode) {
          const tpl = { ...child(aset, "SegmentTemplate")?.attrs, ...child(rep, "SegmentTemplate")?.attrs };
          if (!tpl.media) throw new TidepullError("SegmentTemplate without @media");
          if (tpl.initialization) r.init = resolve(baseR, fillTemplate(tpl.initialization, vars));
          const timescale = Number(tpl.timescale ?? 1) || 1;
          let n = Number(tpl.startNumber ?? 1);
          const frags: string[] = [];
          const push = (num: number, time?: number) => {
            if (frags.length >= MAX_FRAGMENTS) throw new TidepullError(`Too many fragments (>${MAX_FRAGMENTS})`);
            frags.push(resolve(baseR, fillTemplate(tpl.media, { ...vars, Number: num, Time: time })));
          };
          const timeline = child(tplNode, "SegmentTimeline") ?? child(aset, "SegmentTimeline");
          if (timeline) {
            let t = 0;
            for (const s of kids(timeline, "S")) {
              if (s.attrs.t !== undefined) t = Number(s.attrs.t);
              const d = Number(s.attrs.d);
              if (!(d > 0)) throw new TidepullError("SegmentTimeline entry without a positive @d");
              let rep_ = Number(s.attrs.r ?? 0);
              if (rep_ < 0) {
                if (!periodDur) throw new TidepullError("Open-ended SegmentTimeline repeat needs a known duration");
                rep_ = Math.ceil((periodDur * timescale - t) / d) - 1;
              }
              for (let i = 0; i <= rep_; i++, n++, t += d) push(n, t);
            }
          } else if (tpl.duration) {
            if (!periodDur) throw new TidepullError("Duration-based SegmentTemplate needs a known presentation duration");
            const count = Math.ceil(periodDur / (Number(tpl.duration) / timescale));
            for (let i = 0; i < count; i++) push(n + i);
          } else throw new TidepullError("SegmentTemplate has neither SegmentTimeline nor @duration");
          r.fragments = frags;
        } else if (listNode) {
          const init = child(listNode, "Initialization");
          if (init?.attrs.range || kids(listNode, "SegmentURL").some((u) => u.attrs.mediaRange)) throw new TidepullError("Byte-range SegmentList is not supported yet");
          if (init?.attrs.sourceURL) r.init = resolve(baseR, init.attrs.sourceURL);
          r.fragments = kids(listNode, "SegmentURL").map((u) => resolve(baseR, u.attrs.media));
        } else {
          r.single = baseR; // SegmentBase / plain BaseURL: one self-contained file
        }
        out.reps.push(r);
      } catch (e) {
        out.skipped.push(`${id}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }
  return out;
}
