import { TidepullError } from "./errors.ts";

export interface HlsVariant {
  url: string;
  bandwidth: number;
  width?: number;
  height?: number;
  fps?: number;
  codecs?: string;
  audioGroup?: string;
}
export interface HlsRendition {
  type: string;
  groupId: string;
  name: string;
  uri?: string;
  isDefault: boolean;
  language?: string;
}
export interface HlsMaster {
  variants: HlsVariant[];
  renditions: HlsRendition[];
}
export interface HlsKey {
  method: "AES-128";
  uri: string;
  iv?: Buffer;
}
export interface HlsSegment {
  url: string;
  duration: number;
  seq: number;
  key?: HlsKey;
  map?: string;
}
export interface HlsMedia {
  segments: HlsSegment[];
  endList: boolean;
}

const val = (line: string) => line.slice(line.indexOf(":") + 1);
const lines = (text: string) => text.split(/\r?\n/).map((l) => l.trim());

export function isMasterPlaylist(text: string): boolean {
  return text.includes("#EXT-X-STREAM-INF");
}

export function parseAttributes(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([A-Z0-9-]+)=("[^"]*"|[^,]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    let v = m[2];
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    out[m[1]] = v;
  }
  return out;
}

export function parseMaster(text: string, base: string): HlsMaster {
  const ls = lines(text);
  const variants: HlsVariant[] = [];
  const renditions: HlsRendition[] = [];
  for (let i = 0; i < ls.length; i++) {
    const line = ls[i];
    if (line.startsWith("#EXT-X-STREAM-INF:")) {
      const a = parseAttributes(val(line));
      let j = i + 1;
      while (j < ls.length && (ls[j] === "" || ls[j].startsWith("#"))) j++;
      if (!ls[j]) continue;
      const [w, h] = (a.RESOLUTION ?? "").split("x").map(Number);
      variants.push({
        url: new URL(ls[j], base).href,
        bandwidth: Number(a.BANDWIDTH ?? 0),
        width: w || undefined,
        height: h || undefined,
        fps: a["FRAME-RATE"] ? Number(a["FRAME-RATE"]) : undefined,
        codecs: a.CODECS,
        audioGroup: a.AUDIO,
      });
      i = j;
    } else if (line.startsWith("#EXT-X-MEDIA:")) {
      const a = parseAttributes(val(line));
      renditions.push({
        type: a.TYPE ?? "",
        groupId: a["GROUP-ID"] ?? "",
        name: a.NAME ?? "",
        uri: a.URI ? new URL(a.URI, base).href : undefined,
        isDefault: a.DEFAULT === "YES",
        language: a.LANGUAGE,
      });
    }
  }
  return { variants, renditions };
}

function parseIv(s: string): Buffer {
  return Buffer.from(s.replace(/^0x/i, "").padStart(32, "0"), "hex");
}

export function parseMedia(text: string, base: string): HlsMedia {
  const ls = lines(text).filter(Boolean);
  if (ls[0] !== "#EXTM3U") throw new TidepullError("Not an HLS playlist (missing #EXTM3U)");
  let seq = 0;
  let dur = 0;
  let endList = false;
  let key: HlsKey | undefined;
  let map: string | undefined;
  const segments: HlsSegment[] = [];

  for (const line of ls) {
    if (line.startsWith("#EXT-X-MEDIA-SEQUENCE:")) seq = Number(val(line)) || 0;
    else if (line.startsWith("#EXTINF:")) dur = parseFloat(val(line)) || 0;
    else if (line.startsWith("#EXT-X-ENDLIST")) endList = true;
    else if (line.startsWith("#EXT-X-BYTERANGE")) throw new TidepullError("HLS byte-range segments are not supported yet");
    else if (line.startsWith("#EXT-X-KEY:")) {
      const a = parseAttributes(val(line));
      if (a.METHOD === "NONE") key = undefined;
      else if (a.METHOD === "AES-128" && a.URI) {
        key = { method: "AES-128", uri: new URL(a.URI, base).href, iv: a.IV ? parseIv(a.IV) : undefined };
      } else throw new TidepullError(`Unsupported HLS encryption: ${a.METHOD}`);
    } else if (line.startsWith("#EXT-X-MAP:")) {
      const a = parseAttributes(val(line));
      if (a.BYTERANGE) throw new TidepullError("HLS byte-range init segments are not supported yet");
      map = a.URI ? new URL(a.URI, base).href : undefined;
    } else if (!line.startsWith("#")) {
      segments.push({ url: new URL(line, base).href, duration: dur, seq: seq + segments.length, key, map });
      dur = 0;
    }
  }
  return { segments, endList };
}
