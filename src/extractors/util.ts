const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", "#39": "'", "#x2F": "/", "#47": "/" };

export const decodeEntities = (s: string): string => s.replace(/&(#?\w+);/g, (m, e: string) => ENTITIES[e] ?? m);

export const extOf = (pathname: string): string => /\.([a-z0-9]{2,5})$/i.exec(pathname)?.[1]?.toLowerCase() ?? "";

export function stem(pathname: string): string {
  const base = decodeURIComponent(pathname.split("/").filter(Boolean).pop() ?? "");
  return base.replace(/\.[a-z0-9]{2,5}$/i, "");
}

const VIDEO_CODEC = /^(avc|hvc|hev|dvh|av01|vp0?[89]|mp4v)/i;
const AUDIO_CODEC = /^(mp4a|opus|ac-3|ec-3|flac|vorbis|mp3)/i;

export function splitCodecs(codecs?: string): { v?: string; a?: string } {
  const parts = (codecs ?? "").split(",").map((s) => s.trim());
  return { v: parts.find((c) => VIDEO_CODEC.test(c)), a: parts.find((c) => AUDIO_CODEC.test(c)) };
}
