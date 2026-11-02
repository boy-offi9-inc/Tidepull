/**
 * Playlist helpers (opt-in: "@boy-offi9-inc/tidepull/playlist"): choose items and download every entry of a playlist.
 * Entries are extracted one at a time with `trust: false`, so secret headers never go to hosts named inside a feed.
 */
import { TidepullError } from "./core/errors.ts";
import { isPlaylist, type DownloadOptions } from "./core/pipeline.ts";
import type { Info, Playlist, PlaylistEntry } from "./core/types.ts";
import type { CallOptions, Tidepull } from "./tidepull.ts";

/** Item numbers from a spec like "1-3,7,10-" (1-based, in the order given, no duplicates). Empty spec selects everything. */
export function parseItems(spec: string | undefined, total: number): number[] {
  if (!spec?.trim()) return Array.from({ length: total }, (_, i) => i + 1);
  const out: number[] = [];
  const seen = new Set<number>();
  for (const token of spec.split(",").map((s) => s.trim()).filter(Boolean)) {
    const m = /^(\d*)-(\d*)$/.exec(token) ?? /^(\d+)$/.exec(token);
    if (!m) throw new TidepullError(`Invalid playlist items "${token}" (examples: 1-3,7,10-)`, 2);
    const first = m[1] === "" ? 1 : Number(m[1]);
    const last = m[2] === undefined ? first : m[2] === "" ? total : Number(m[2]);
    if (first < 1) throw new TidepullError(`Playlist items start at 1, got "${token}"`, 2);
    for (let i = first; i <= Math.min(last, total); i++) {
      if (!seen.has(i)) {
        seen.add(i);
        out.push(i);
      }
    }
  }
  return out;
}

export interface PlaylistItem {
  /** 1-based position in the playlist */
  index: number;
  /** 1-based position among the selected items */
  position: number;
  /** number of selected items */
  total: number;
  /** undefined when the URL was a single item */
  playlist?: Playlist;
  entry?: PlaylistEntry;
  info?: Info;
  /** why this entry could not be extracted */
  error?: Error;
}

/**
 * Template fields for an item: playlist, playlist_id, playlist_index, playlist_count. Empty for a single item.
 * When the extractor's own title is just the id (a bare file name), the entry's title from the playlist is used instead.
 */
export const playlistFields = (item: PlaylistItem): Record<string, string | number> => {
  if (!item.playlist) return {};
  const fields: Record<string, string | number> = {
    playlist: item.playlist.title,
    playlist_id: item.playlist.id,
    playlist_index: item.index,
    playlist_count: item.playlist.entries.length,
  };
  if (item.entry?.title && item.info && item.info.title === item.info.id) fields.title = item.entry.title;
  return fields;
};

/**
 * One item for a single URL, or one per selected entry of a playlist (extracted lazily, in order).
 * An entry that fails to extract is reported on the item instead of ending the iteration.
 * `source` may be a URL or an already resolved Info/Playlist.
 */
export async function* resolveItems(tp: Tidepull, source: string | Info | Playlist, o: CallOptions & { items?: string } = {}): AsyncGenerator<PlaylistItem> {
  const first = typeof source === "string" ? await tp.resolve(source, o) : source;
  if (!isPlaylist(first)) {
    yield { index: 1, position: 1, total: 1, info: first };
    return;
  }
  const picked = parseItems(o.items, first.entries.length);
  tp.emit({ type: "playlist", title: first.title, count: first.entries.length, selected: picked.length });
  for (const [i, index] of picked.entries()) {
    const entry = first.entries[index - 1];
    const base = { index, position: i + 1, total: picked.length, playlist: first, entry };
    tp.emit({ type: "item", index, position: i + 1, total: picked.length, url: entry.url, ...(entry.title ? { title: entry.title } : {}) });
    try {
      yield { ...base, info: await tp.extract(entry.url, { signal: o.signal, trust: false }) };
    } catch (e) {
      if (o.signal?.aborted) throw e;
      yield { ...base, error: e as Error };
    }
  }
}

export interface PullAllOptions extends Partial<DownloadOptions>, CallOptions {
  /** which playlist items to download, e.g. "1-3,7,10-" (default: all) */
  items?: string;
  /** called for an item that fails; without it the first failure is thrown */
  onError?: (error: Error, item: PlaylistItem) => void;
}

/** Downloads a single item, or every selected entry of a playlist, and returns the files in order. */
export async function pullAll(tp: Tidepull, source: string, o: PullAllOptions = {}): Promise<string[]> {
  const { items, onError, ...rest } = o;
  const files: string[] = [];
  for await (const item of resolveItems(tp, source, { items, signal: o.signal, trust: o.trust })) {
    try {
      if (item.error) throw item.error;
      files.push(await tp.download(item.info as Info, { ...rest, fields: { ...rest.fields, ...playlistFields(item) } }));
    } catch (e) {
      if (o.signal?.aborted || !onError) throw e;
      onError(e as Error, item);
    }
  }
  return files;
}
