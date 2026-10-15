import { downloadInfo, extractInfo, DEFAULT_OUTPUT, type DownloadOptions } from "./core/pipeline.ts";
import { abortError } from "./core/errors.ts";
import { makeLog, type TidepullEvent } from "./core/events.ts";
import { Http, type HttpOptions } from "./core/http.ts";
import { DEFAULT_FORMAT, selectFormats } from "./core/selector.ts";
import type { Ctx, Extractor, Format, Info } from "./core/types.ts";
import { buildRegistry } from "./extractors/index.ts";
import type { TidepullPlugin } from "./plugins.ts";

export type Listener = (e: TidepullEvent) => void;

export interface TidepullOptions {
  http?: HttpOptions;
  plugins?: TidepullPlugin[];
  /** ffmpeg binary or directory (default: search PATH) */
  ffmpeg?: string;
  onEvent?: Listener;
}

export interface CallOptions {
  signal?: AbortSignal;
}

/**
 * The library entry point. No terminal I/O: everything observable goes through events.
 *
 *   const g = createTidepull();
 *   g.on((e) => e.type === "progress" && console.log(e.downloaded, e.total));
 *   const info = await g.extract(url);
 *   const file = await g.download(info, { format: "bv*[height<=720]+ba/b", paths: "./out" });
 */
export class Tidepull {
  readonly http: Http;
  private plugins: TidepullPlugin[];
  private registry: Extractor[];
  private listeners = new Set<Listener>();
  private ffmpeg?: string;

  constructor(o: TidepullOptions = {}) {
    this.http = new Http({ headerHosts: [], ...o.http });
    this.plugins = [...(o.plugins ?? [])];
    this.registry = buildRegistry(this.plugins);
    this.ffmpeg = o.ffmpeg;
    if (o.onEvent) this.listeners.add(o.onEvent);
  }

  /** Subscribe to events. Returns an unsubscribe function. A throwing listener never breaks a download. */
  on(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  }

  /** Extractor names in priority order. */
  get extractors(): string[] {
    return this.registry.map((e) => e.name);
  }

  /** Register a plugin (takes priority over built-in extractors). */
  use(plugin: TidepullPlugin): this {
    this.plugins.push(plugin);
    this.registry = buildRegistry(this.plugins);
    return this;
  }

  private ctx(signal?: AbortSignal): Ctx {
    const emit = (e: TidepullEvent) => {
      for (const l of this.listeners) {
        try {
          l(e);
        } catch {
          /* listeners must not break the engine */
        }
      }
    };
    return { http: this.http.scoped(signal), emit, log: makeLog(emit), extractors: this.registry, signal };
  }

  private async guard<T>(signal: AbortSignal | undefined, fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (signal?.aborted) throw abortError();
      throw e;
    }
  }

  extract(url: string, o: CallOptions = {}): Promise<Info> {
    try {
      this.http.trust(/^[a-z][a-z0-9+.-]*:\/\//i.test(url) ? url : `https://${url}`);
    } catch {
      /* invalid URL: extractInfo reports it */
    }
    return this.guard(o.signal, () => extractInfo(url, this.ctx(o.signal)));
  }

  /** Pure function: which format(s) would this selector pick? 2+ means "merge". undefined = no match. */
  select(info: Info, selector: string = DEFAULT_FORMAT): Format[] | undefined {
    return selectFormats(selector, info.formats);
  }

  /** Downloads the selected format(s). Resolves to the final file path. */
  download(info: Info, o: Partial<DownloadOptions> & CallOptions = {}): Promise<string> {
    const { signal, ...rest } = o;
    const opts: DownloadOptions = {
      format: DEFAULT_FORMAT,
      output: DEFAULT_OUTPUT,
      paths: ".",
      resume: true,
      overwrite: false,
      concurrency: 4,
      mergeFormat: "mp4",
      ffmpeg: this.ffmpeg,
      headers: {},
      ...rest,
    };
    const ctx = this.ctx(signal);
    return this.guard(signal, async () => {
      const file = await downloadInfo(info, opts, ctx);
      ctx.emit({ type: "done", file });
      return file;
    });
  }

  /** extract + download */
  async pull(url: string, o: Partial<DownloadOptions> & CallOptions = {}): Promise<string> {
    return this.download(await this.extract(url, o), o);
  }
}

export const createTidepull = (o?: TidepullOptions): Tidepull => new Tidepull(o);
