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
```

**Batch and archive.** `-a FILE` reads one URL per line (`#` starts a comment, `-` reads stdin). `--download-archive FILE` records each finished item and skips it on later runs.

**Config file.** Defaults go in `~/.config/tidepull/config` (or `--config-location FILE`): one or more options per line, `#` for comments, for example `-P ~/Videos` and `--limit-rate 2M`. Options on the command line win; `--no-config` ignores the file.

From a clone, `node src/cli.ts <args>` runs the TypeScript source directly (Node >= 22.18); `npm run build` emits JS + `.d.ts`.

## What works today
| Area | Status |
|---|---|
| Direct files | resumable (`.part` + `Range`), retries with backoff |
| HLS VOD | master + media playlists, parallel segments written in order, AES-128 (explicit/default IV), fMP4 init maps, separate audio renditions |
| DASH VOD (`.mpd`), opt-in via `@boy-offi9-inc/tidepull/dash` (built into the CLI) | `SegmentTemplate` (`$Number%05d$`, `$Time$`, timelines, durations), `SegmentList`, single-file `SegmentBase`, nested `BaseURL`; encrypted (`ContentProtection`) representations are skipped, never decrypted |
| Generic page extractor | `og:video`, `<video>/<source>`, bare media URLs in HTML/JSON |
| Format selector | `b bv bv* ba ba* w wv wa`, `+` merge, `/` fallback, `()` groups, `[height<=720]` `[filesize<?50M]` `[ext=mp4]` |
| Output templates | `%(title)s`, `%(x\|default)s`, `%(title).50s`, sanitized |
| Merge / remux | ffmpeg |
| Site-specific extractors | none built in. Platforms such as YouTube hide their media behind scripts and tokens and need a plugin (see Plugins) |
| Not yet | live HLS/DASH, multi-period DASH, SAMPLE-AES, byte-range HLS/DASH, playlists, subtitles, cookies |

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
- **Redirect-safe HTTP.** Redirects are followed manually: on a cross-origin hop everything except `User-Agent/Accept*/Range` is dropped (Authorization, Cookie, custom tokens), non-http(s) targets are refused, loops are capped.
- **Origin-scoped secrets.** Custom headers like `Authorization`, `Cookie` or API tokens (`--header` / `http.headers`) are sent only to the origins you pass to `extract()`/`pull()`, plus any `--header-host` / `http.headerHosts` patterns (`cdn.example.com`, `*.example.com`). `Referer`, `Origin`, `Accept*`, `User-Agent` and `Range` are never treated as secret. Using one `Tidepull` instance for several sites trusts all of them, so use one instance per credential. The low-level `Http` class (without `headerHosts`) sends headers to each request's start origin only.
- Output filenames are built from sanitized fields only. Only `http(s)` URLs are accepted.

## Legal
Only download content you own or are permitted to download; you're responsible for complying with site terms and local law. MIT licensed.
