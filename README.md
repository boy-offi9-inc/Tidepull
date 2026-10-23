# tidepull

A minimal, from-scratch media downloader **library** (and CLI) for Node. Minimal by design: a ~22 KB minified core with no runtime dependencies today (~9 KB gzip), fully typed, no terminal code in the core. Everything that isn't needed by every user is opt-in.

## Install

```bash
npm i @boy-offi9-inc/tidepull        # as a library
npx @boy-offi9-inc/tidepull -F <url>   # or run the CLI without installing
npm i -g @boy-offi9-inc/tidepull     # installs the `tidepull` command
```

Published under the `@boy-offi9-inc` npm scope; the command it installs is `tidepull`.

Requires Node >= 22.18. ffmpeg is optional (only needed to merge video+audio or remux).

## Use

```ts
import { createTidepull } from "@boy-offi9-inc/tidepull";

const g = createTidepull();
g.on((e) => e.type === "progress" && console.log(e.downloaded, e.total, e.speed));

const info = await g.extract("https://example.com/stream/master.m3u8");
const [video, audio] = g.select(info, "bv*[height<=720]+ba/b") ?? [];   // pure, no network
const file = await g.download(info, { format: "bv*[height<=720]+ba/b", paths: "./out" });
```

Cancel anything with an `AbortSignal`; partial `.part` files are kept so the next run resumes:

```ts
const ctl = new AbortController();
setTimeout(() => ctl.abort(), 5000);
await g.pull(url, { signal: ctl.signal });        // rejects with name === "AbortError"
```

Cap the speed with `limitRate` (bytes per second, applied to each file): `g.download(info, { limitRate: 1_000_000 })`.

## API (everything else is internal)
| Export | Purpose |
|---|---|
| `createTidepull(opts?)` → `Tidepull` | `.extract(url)`, `.select(info, selector)`, `.download(info, opts)`, `.pull(url, opts)`, `.on(listener)`, `.use(plugin)`, `.extractors` |
| `definePlugin`, `PLUGIN_API_VERSION` | write extractor plugins |
| `@boy-offi9-inc/tidepull/dash` *(opt-in)* | DASH VOD: `createTidepull({ plugins: [dash] })` |
| `@boy-offi9-inc/tidepull/loader` *(opt-in)* | `loadPlugins(paths)` / `loadPlugin(file)`: load plugins from disk |
| `@boy-offi9-inc/tidepull/cookies` *(opt-in)* | `parseCookies`, `loadCookieFile`, `cookieJar`: `createTidepull({ http: { cookies: cookieJar(cookies) } })` |
| `selectFormats`, `renderTemplate`, `parseHlsMaster/Media` | the building blocks, usable standalone |
| `Http`, `TidepullError` | redirect-safe, header-scoped HTTP client; error type |
| types | `Info`, `Format`, `Extractor`, `TidepullEvent`, `DownloadOptions`, `TidepullPlugin`, ... |

### Events (plain JSON, ideal for GUIs/IPC)
`extract` · `start` · `progress {downloaded,total,estimated,speed,eta}` · `finish` · `merge` · `remux` · `done {file}` · `log {level,tag,message}` · `error`

CLI: `tidepull --progress-json URL` prints the same events as NDJSON on stdout.

## Plugins (fix a site without waiting for a release)
```ts
// ~/.config/tidepull/plugins/mysite.ts   (or --plugin ./mysite.ts, or g.use(...))
import { definePlugin } from "@boy-offi9-inc/tidepull";
export default definePlugin({
  name: "mysite", apiVersion: 1,
  extractors: [{
    name: "mysite",
    suitable: (u) => u.hostname === "mysite.example",
    async extract(u, ctx) { /* ctx.http is redirect-safe + cancellable */ return { id, title, extractor: "mysite", webpage_url: u.href, formats: [...] }; },
  }],
});
```
Plugins run before built-ins; the generic fallback is always last. From disk: `import { loadPlugins } from "@boy-offi9-inc/tidepull/loader"` (the CLI does this for you, and bundles DASH). A plugin targeting a different `apiVersion` is refused with a clear message instead of failing mysteriously. **Plugins execute with your privileges. Only load code you trust.** See `src/extractors/_template.ts`.

## CLI
```bash
tidepull -F URL                                    # list formats
tidepull -f "bv*[height<=720]+ba/b" URL            # select + merge (needs ffmpeg)
tidepull -o "%(title).60s [%(id)s].%(ext)s" -P ~/Videos URL
tidepull -j URL | jq .formats                      # data on stdout, logs on stderr
tidepull -a urls.txt --download-archive done.txt   # batch input; skip what you already downloaded
tidepull --limit-rate 1M URL                       # cap the speed (500K, 1.5M, ...)
tidepull --cookies cookies.txt URL                 # use your own logged-in session
```

**Cookies.** `--cookies FILE` reads a Netscape `cookies.txt` (the format browser extensions export). Each cookie is sent only to the host, path and scheme it was issued for. Keep the file private (`chmod 600`); you get a warning if other users can read it.

**Batch and archive.** `-a FILE` reads one URL per line (`#` starts a comment, `-` reads stdin). `--download-archive FILE` records each finished item and skips it on later runs.

**Config file.** Defaults go in `~/.config/tidepull/config` (or `--config-location FILE`): one or more options per line, `#` for comments, for example `-P ~/Videos` and `--limit-rate 2M`. Options on the command line win; `--no-config` ignores the file.

From a clone, `node src/cli.ts <args>` runs the TypeScript source directly (Node >= 22.18); `npm run build` emits JS + `.d.ts`.

## Capabilities and limits

**What Tidepull does**
- Downloads direct media files, HLS (VOD, AES-128) and DASH (VOD) streams, and pages that embed them
- Resumes interrupted downloads, caps speed, retries with backoff and cancels cleanly
- Merges separate video and audio, or remuxes, with ffmpeg
- Selects formats (`bv*[height<=720]+ba/b`) and names files from templates
- Uses your own cookies (`--cookies`) and headers, sending them only to the hosts they belong to
- Works as a CLI or a typed library with JSON events; support for a specific site is added through plugins

**What it does not do**
- No site-specific extractors are built in. Platforms such as YouTube hide their media behind scripts and tokens and need a plugin
- No DRM: protected streams (Widevine, PlayReady, FairPlay, encrypted DASH) are not supported and will not be
- No circumvention: it cannot get past logins, paywalls or geo-blocks. With `--cookies` it only fetches what your own session can already see
- Not implemented yet: live streams, multi-period DASH (first period only), SAMPLE-AES, byte-range HLS/DASH, subtitles, playlists, a proxy option
- Cookies are read-only: `Set-Cookie` responses are not stored

### Details
| Area | Behavior |
|---|---|
| Direct files | resumable (`.part` + `Range`), retries with backoff |
| HLS VOD | master + media playlists, parallel segments written in order, AES-128 (explicit/default IV), fMP4 init maps, separate audio renditions |
| DASH VOD (`.mpd`), opt-in via `@boy-offi9-inc/tidepull/dash` (built into the CLI) | `SegmentTemplate` (`$Number%05d$`, `$Time$`, timelines, durations), `SegmentList`, single-file `SegmentBase`, nested `BaseURL`; encrypted (`ContentProtection`) representations are skipped, never decrypted |
| Generic page extractor | `og:video`, `<video>/<source>`, bare media URLs in HTML/JSON |
| Format selector | `b bv bv* ba ba* w wv wa`, `+` merge, `/` fallback, `()` groups, `[height<=720]` `[filesize<?50M]` `[ext=mp4]` |
| Output templates | `%(title)s`, `%(x\|default)s`, `%(title).50s`, sanitized |
| Cookies | Netscape `cookies.txt`; matched by domain, path, `Secure` and expiry; re-evaluated on every redirect hop |
| CLI conveniences | `-a` batch input, `--download-archive`, `--limit-rate`, `--config-location` |
| Merge / remux | ffmpeg |

## Footprint (enforced in CI)
The core does only what every user needs: extract → select → download, events, cancellation. Everything else is a plugin or an opt-in subpath.

| Import | Files | Raw | Gzip | Minified (gzip) |
|---|---|---|---|---|
| `@boy-offi9-inc/tidepull` (core: direct, HLS, generic page, selector, templates, resume, merge) | 18 | 44.9 KB | 13.5 KB | 22 KB (9 KB) |
| `@boy-offi9-inc/tidepull/dash` (adds XML + MPD parsing) | +6 | +14 KB | +4.7 KB | +7 KB (+3 KB) |
| `@boy-offi9-inc/tidepull/loader` (plugins from disk) | +3 | +4 KB | +1.7 KB | n/a (Node only) |

`npm run size` fails the build if the core grows past its budget. CLI and terminal UI are not part of `import "@boy-offi9-inc/tidepull"`.

## Security model
- **No shell, ever.** ffmpeg is spawned with argv arrays. There is deliberately no `--exec` and no `--netrc-cmd`-style hook; the command-injection CVEs in this space came from exactly those features.
- **Redirect-safe HTTP.** Redirects are followed manually and headers are recomputed on every hop: secrets and per-request headers stay with their own host, non-http(s) targets are refused, loops are capped.
- **Origin-scoped secrets.** Custom headers like `Authorization`, `Cookie` or API tokens (`--header` / `http.headers`) are sent only to the origins you pass to `extract()`/`pull()`, plus any `--header-host` / `http.headerHosts` patterns (`cdn.example.com`, `*.example.com`). `Referer`, `Origin`, `Accept*`, `User-Agent` and `Range` are never treated as secret. Using one `Tidepull` instance for several sites trusts all of them, so use one instance per credential. The low-level `Http` class (without `headerHosts`) sends headers to each request's start origin only.
- **Per-host cookies.** `--cookies` sends each cookie only to the host, path and scheme it was issued for (`Secure` cookies never go over http). A cookie with a single-label domain such as `.com` is treated as host-only. Cookie values are never logged and never appear in `-j` output.
- Output filenames are built from sanitized fields only. Only `http(s)` URLs are accepted.

## Legal
Only download content you own or are permitted to download; you're responsible for complying with site terms and local law. MIT licensed.
