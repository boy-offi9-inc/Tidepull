import { TidepullError, RedirectError, errMsg } from "./errors.ts";

export interface HttpOptions {
  headers?: Record<string, string>;
  userAgent?: string;
  retries?: number;
  timeoutMs?: number;
  maxRedirects?: number;
  /**
   * Scope for non-trivial custom headers (Authorization, Cookie, API tokens...).
   * undefined  = legacy/low-level mode: headers go to the origin each request starts at.
   * string[]   = scoped mode: they go ONLY to origins passed to `trust()` plus these host patterns
   *              ("cdn.example.com" or "*.example.com"). Tidepull uses scoped mode.
   * Referer, Origin, User-Agent, Accept-* and Range are never considered secret and are always sent.
   */
  headerHosts?: string[];
}

export interface RequestInitLite {
  method?: string;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const REDIRECT = new Set([301, 302, 303, 307, 308]);
/** Never secret: always sent wherever we connect. Everything else is "scoped" (see HttpOptions.headerHosts). */
const OPEN_HEADERS = new Set(["user-agent", "accept", "accept-language", "accept-encoding", "range", "referer", "origin"]);

const hostMatches = (pattern: string, host: string): boolean =>
  pattern.startsWith("*.") ? host === pattern.slice(2) || host.endsWith(pattern.slice(1)) : host === pattern;

export class Http {
  /** non-secret defaults (UA, Accept-Language, Referer...), always sent */
  headers: Record<string, string>;
  /** custom headers that may be secret; sent only to trusted origins (scoped mode) */
  private secret: Record<string, string>;
  private scopedMode: boolean;
  private hostPatterns: string[];
  private trusted = new Set<string>();
  retries: number;
  timeoutMs: number;
  maxRedirects: number;
  private defaultSignal?: AbortSignal;

  constructor(o: HttpOptions = {}) {
    this.headers = {
      "User-Agent": o.userAgent ?? "Mozilla/5.0 (compatible; tidepull/0.1)",
      "Accept-Language": "en-US,en;q=0.9",
    };
    this.secret = {};
    for (const [k, v] of Object.entries(o.headers ?? {})) {
      if (OPEN_HEADERS.has(k.toLowerCase())) this.headers[k] = v;
      else this.secret[k] = v;
    }
    this.scopedMode = o.headerHosts !== undefined;
    this.hostPatterns = (o.headerHosts ?? []).map((h) => h.toLowerCase());
    this.retries = o.retries ?? 3;
    this.timeoutMs = o.timeoutMs ?? 30_000;
    this.maxRedirects = o.maxRedirects ?? 10;
  }

  /** Allow scoped headers to be sent to this URL's origin (scoped mode only). Tidepull calls this for every URL you give it. */
  trust(url: string | URL): void {
    this.trusted.add(new URL(url).origin);
  }

  private headersFor(u: URL, start: URL): Record<string, string> {
    const send = this.scopedMode ? this.trusted.has(u.origin) || this.hostPatterns.some((p) => hostMatches(p, u.hostname)) : u.origin === start.origin;
    return send ? { ...this.headers, ...this.secret } : { ...this.headers };
  }

  /** A view of this client whose requests are cancelled by `signal` (so extractors don't need to pass it around). */
  scoped(signal?: AbortSignal): Http {
    if (!signal) return this;
    const h = Object.create(this) as Http;
    h.defaultSignal = signal;
    return h;
  }

  /** fetch with manual, origin-aware redirects + retry (network errors, 5xx, 429) with backoff. The timeout covers headers only. */
  async request(url: string, init: RequestInitLite = {}): Promise<Response> {
    init = { ...init, signal: init.signal ?? this.defaultSignal };
    let lastErr: unknown;
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      if (attempt > 0) await sleep(Math.min(250 * 2 ** (attempt - 1), 8000));
      init.signal?.throwIfAborted();
      try {
        const res = await this.follow(url, init);
        if ((res.status >= 500 || res.status === 429) && attempt < this.retries) {
          await res.body?.cancel();
          lastErr = new TidepullError(`HTTP ${res.status}`);
          continue;
        }
        return res;
      } catch (e) {
        if (init.signal?.aborted || e instanceof RedirectError) throw e;
        lastErr = e;
      }
    }
    throw new TidepullError(`Unable to reach ${url}: ${errMsg(lastErr)}`);
  }

  private async follow(url: string, init: RequestInitLite): Promise<Response> {
    const start = new URL(url);
    let cur = start;
    for (let hop = 0; ; hop++) {
      // per-request headers (Range, extractor-supplied Referer/Cookie...) only travel with the start origin; Range goes everywhere
      const own = Object.fromEntries(Object.entries(init.headers ?? {}).filter(([k]) => cur.origin === start.origin || k.toLowerCase() === "range"));
      const headers = { ...this.headersFor(cur, start), ...own };
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), this.timeoutMs);
      const signal = init.signal ? AbortSignal.any([ctl.signal, init.signal]) : ctl.signal;
      let res: Response;
      try {
        res = await fetch(cur, { method: init.method, headers, redirect: "manual", signal });
      } finally {
        clearTimeout(timer);
      }
      if (!REDIRECT.has(res.status)) return res;

      await res.body?.cancel();
      const loc = res.headers.get("location");
      if (!loc) throw new RedirectError(`HTTP ${res.status} without Location from ${cur.href}`);
      if (hop >= this.maxRedirects) throw new RedirectError(`Too many redirects (>${this.maxRedirects}) starting at ${url}`);
      const next = new URL(loc, cur);
      if (next.protocol !== "http:" && next.protocol !== "https:") throw new RedirectError(`Refusing redirect to ${next.protocol} URL`);
      cur = next;
    }
  }

  async text(url: string, init: RequestInitLite = {}): Promise<{ text: string; finalUrl: string }> {
    const res = await this.request(url, init);
    if (!res.ok) {
      await res.body?.cancel();
      throw new TidepullError(`HTTP ${res.status} ${res.statusText} for ${url}`);
    }
    return {
      text: await res.text(),
      finalUrl: res.url || url,
    };
  }
}
