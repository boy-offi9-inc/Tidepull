# Contributing

```bash
npm i
npm run dev -- --help     # runs src/cli.ts directly (Node 22.18+ strips types natively)
npm test                  # local HTTP fixture: Range/resume, HLS+AES, ffmpeg merge
npm run typecheck
```

- **Minimal, not just dependency-free.** No runtime dependencies today (add one only where it replaces a lot of code), *and* a small core: `npm run size` enforces a budget. If a feature isn't needed by every user (a protocol, a site, a loader), it ships as a plugin or an opt-in subpath like `@boy-offi9-inc/tidepull/dash`, never in the default import path.
- **Erasable TypeScript only** (no enums / namespaces / parameter properties) so the source runs unbuilt.
- **stdout = data, stderr = humans.** Never `console.log` progress or status.
- New site support = a plugin (see `src/extractors/_template.ts`) + a test against a local fixture. No tests hitting real sites. Breaking plugin-contract changes bump `PLUGIN_API_VERSION`.
- **The core never prints.** Report progress/status via `ctx.emit(...)` events; terminal output lives in `src/ui/` only.
- Any new HTTP code goes through `Http` (redirect policy + cancellation), never bare `fetch`.
- Never pass user input through a shell. Spawn with argv arrays.

## Live checks

A weekly workflow (`.github/workflows/live-smoke.yml`) takes every URL in `.github/live-targets.txt` (one per line, `#` for comments), extracts it, selects a format and range-requests the media. If a target stops working it opens (or updates) an issue labeled `live-smoke`, and closes it once everything passes again. Only add URLs you are allowed to download. You can also run it on demand from the Actions tab.

Good first issues: live HLS/DASH, multi-period DASH, cookies (`--cookies`), HLS byte-ranges, playlists, subtitles, `--download-archive`.
