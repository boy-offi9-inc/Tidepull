import { parseArgs } from "node:util";
import { DEFAULT_FORMAT, selectFormats } from "./core/selector.ts";
import { TidepullError, errMsg } from "./core/errors.ts";
import { existsSync, readFileSync } from "node:fs";
import type { DownloadOptions } from "./core/pipeline.ts";
import type { Info } from "./core/types.ts";
import { Archive, configArgs, parseRate, readUrlList } from "./cliutil.ts";
import { cookieJar, loadCookieFile } from "./cookies.ts";
import { createTidepull } from "./tidepull.ts";
import dash from "./dash/index.ts";
import { defaultPluginDir, loadPlugins } from "./loader.ts";
import { table, fmtBytes } from "./ui/format.ts";
import { Logger, shouldUseColor } from "./ui/log.ts";
import { humanRenderer, jsonRenderer } from "./ui/render.ts";

/** Package version, read from package.json. */
export const VERSION: string = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;

const HELP = `tidepull ${VERSION}: a minimal media downloader

Usage: tidepull [options] URL [URL...]

Selection:
  -f, --format FORMAT        Format selector (default: ${DEFAULT_FORMAT})
                               e.g. "bv*[height<=720]+ba/b", "ba", "hls-1200"
  -F, --list-formats         List available formats and exit

Output:
  -o, --output TEMPLATE      Output template (default: "%(title)s [%(id)s].%(ext)s",
                             or just the title when the id is the same)
  -P, --paths DIR            Download directory (default: .)
  -w, --overwrite            Overwrite existing files
      --no-continue          Do not resume partial downloads
      --merge-output-format  Container when merging video+audio (default: mp4)
      --remux-video EXT      Remux the result into EXT with ffmpeg (e.g. mp4)
      --ffmpeg-location PATH ffmpeg binary or directory

Info only (nothing is downloaded):
  -j, --dump-json            Print the info dict as JSON
  -g, --get-url              Print the selected format URL(s)
  -s, --simulate             Extract only
      --print-path           After downloading, print the final file path on stdout
      --list-extractors      List extractors and exit

Plugins:
      --plugin PATH          Load a plugin file or directory (repeatable). Plugins run with your privileges!
      --no-plugins           Skip auto-loading ~/.config/tidepull/plugins (or $TIDEPULL_PLUGIN_DIR)

Input:
  -a, --batch-file FILE      Read URLs from FILE, one per line ("-" = stdin, # starts a comment)
      --download-archive FILE  Skip items listed in FILE; record new ones after downloading

Config:
      --config-location FILE Read options from FILE (default: ~/.config/tidepull/config)
      --no-config            Do not read a config file

Network:
      --limit-rate RATE      Maximum download speed per file, e.g. 500K or 1.5M
      --cookies FILE         Send cookies from a Netscape cookies.txt file, only to the hosts they belong to
  -N, --concurrent-fragments N   HLS segments fetched in parallel (default: 4)
  -R, --retries N                Retries per request (default: 3)
      --header "Name: value"     Extra request header (repeatable). Secret-looking headers (Authorization,
                                 Cookie, tokens...) are sent only to the URL's own origin...
      --header-host HOST         ...plus these hosts ("cdn.example.com" or "*.example.com"), repeatable
      --user-agent UA            Custom User-Agent

General:
  -q, --quiet        Only print errors/warnings
  -v, --verbose      Debug output
      --no-progress  Disable the progress line
      --progress-json  Emit engine events as NDJSON on stdout (for GUIs/scripts)
      --no-color     Disable colors (also honors NO_COLOR)
  -h, --help         Show this help
      --version      Show version

stdout carries data only (-j, -F, -g, --print-path, --progress-json). Everything else goes to stderr.
Exit codes: 0 ok, 1 error, 2 usage error, 130 interrupted.`;

function listFormats(info: Info): string {
  const rows = [["ID", "EXT", "RESOLUTION", "FPS", "│", "SIZE", "TBR", "PROTO", "│", "VCODEC", "ACODEC", "NOTE"]];
  const sorted = [...info.formats].sort((a, b) => (a.height ?? 0) - (b.height ?? 0) || (a.tbr ?? 0) - (b.tbr ?? 0));
  for (const f of sorted) {
    rows.push([
      f.format_id,
      f.ext,
      f.height ? `${f.width ?? "?"}x${f.height}` : f.vcodec === "none" ? "audio only" : "unknown",
      f.fps ? String(f.fps) : "",
      "│",
      f.filesize ? fmtBytes(f.filesize) : "",
      f.tbr ? `${f.tbr}k` : "",
      f.protocol,
      "│",
      f.vcodec === "none" ? "audio only" : f.vcodec,
      f.acodec === "none" ? "video only" : f.acodec,
      f.format_note ?? "",
    ]);
  }
  return table(rows);
}

export async function main(argv: string[]): Promise<number> {
  let values: ReturnType<typeof parse>["values"];
  let positionals: string[];
  function parse() {
    return parseArgs({
      args,
      allowPositionals: true,
      options: {
        format: { type: "string", short: "f" },
        "list-formats": { type: "boolean", short: "F" },
        output: { type: "string", short: "o" },
        paths: { type: "string", short: "P" },
        overwrite: { type: "boolean", short: "w" },
        "no-continue": { type: "boolean" },
        "merge-output-format": { type: "string" },
        "remux-video": { type: "string" },
        "ffmpeg-location": { type: "string" },
        "dump-json": { type: "boolean", short: "j" },
        "get-url": { type: "boolean", short: "g" },
        simulate: { type: "boolean", short: "s" },
        "print-path": { type: "boolean" },
        "list-extractors": { type: "boolean" },
        "concurrent-fragments": { type: "string", short: "N" },
        retries: { type: "string", short: "R" },
        header: { type: "string", multiple: true },
        "header-host": { type: "string", multiple: true },
        "user-agent": { type: "string" },
        quiet: { type: "boolean", short: "q" },
        verbose: { type: "boolean", short: "v" },
        "no-progress": { type: "boolean" },
        "progress-json": { type: "boolean" },
        plugin: { type: "string", multiple: true },
        "no-plugins": { type: "boolean" },
        "batch-file": { type: "string", short: "a" },
        "download-archive": { type: "string" },
        "limit-rate": { type: "string" },
        cookies: { type: "string" },
        "config-location": { type: "string" },
        "no-config": { type: "boolean" },
        "no-color": { type: "boolean" },
        help: { type: "boolean", short: "h" },
        version: { type: "boolean" },
      },
    });
  }
  let args = argv;
  try {
    args = [...configArgs(argv), ...argv];
  } catch (e) {
    process.stderr.write(`ERROR: ${errMsg(e)}\n`);
    return e instanceof TidepullError ? e.exitCode : 2;
  }
  try {
    ({ values, positionals } = parse());
  } catch (e) {
    process.stderr.write(`ERROR: ${errMsg(e)}\nTry 'tidepull --help'.\n`);
    return 2;
  }

  if (values.help) return void process.stdout.write(HELP + "\n"), 0;
  if (values.version) return void process.stdout.write(VERSION + "\n"), 0;

  const log = new Logger({
    quiet: values.quiet,
    verbose: values.verbose,
    color: !values["no-color"] && shouldUseColor(),
  });
  const urls = [...positionals];
  let limitRate: number | undefined;
  let archive: Archive | undefined;
  let cookies: ReturnType<typeof cookieJar> | undefined;
  try {
    if (values["batch-file"]) urls.push(...readUrlList(values["batch-file"]));
    if (values["limit-rate"]) limitRate = parseRate(values["limit-rate"]);
    if (values["download-archive"]) archive = new Archive(values["download-archive"]);
    if (values.cookies) {
      const loaded = loadCookieFile(values.cookies);
      if (loaded.warning) log.warn(loaded.warning);
      cookies = cookieJar(loaded.cookies);
    }
  } catch (e) {
    log.error(errMsg(e));
    return e instanceof TidepullError ? e.exitCode : 1;
  }
  if (!urls.length && !values["list-extractors"]) {
    log.error("You must provide at least one URL. Try 'tidepull --help'.");
    return 2;
  }

  const headers: Record<string, string> = {};
  for (const h of values.header ?? []) {
    const i = h.indexOf(":");
    if (i < 1) {
      log.error(`Bad --header "${h}" (expected "Name: value")`);
      return 2;
    }
    headers[h.slice(0, i).trim()] = h.slice(i + 1).trim();
  }
  const num = (v: string | undefined, d: number) => (v !== undefined && Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : d);

  // plugins: explicit --plugin paths, plus the default dir unless disabled
  const pluginPaths = [...(values.plugin ?? [])];
  const defDir = defaultPluginDir();
  if (!values["no-plugins"] && existsSync(defDir)) pluginPaths.unshift(defDir);
  let plugins: Awaited<ReturnType<typeof loadPlugins>> = [];
  try {
    plugins = await loadPlugins(pluginPaths);
  } catch (e) {
    log.error(errMsg(e));
    return e instanceof TidepullError ? e.exitCode : 1;
  }

  const tp = createTidepull({
    http: { headers, headerHosts: values["header-host"] ?? [], userAgent: values["user-agent"], retries: num(values.retries, 3), cookies },
    plugins: [...plugins, dash],
    ffmpeg: values["ffmpeg-location"],
  });
  tp.on(values["progress-json"] ? jsonRenderer() : humanRenderer(log, { progress: !values["no-progress"] && !values.quiet }));
  for (const p of plugins) log.debug(`Loaded plugin "${p.name}" (${p.extractors?.length ?? 0} extractor(s))`);

  if (values["list-extractors"]) {
    process.stdout.write(tp.extractors.join("\n") + "\n");
    return 0;
  }

  const opts: Partial<DownloadOptions> = {
    format: values.format ?? DEFAULT_FORMAT,
    output: values.output,
    paths: values.paths,
    resume: !values["no-continue"],
    overwrite: !!values.overwrite,
    concurrency: Math.max(1, num(values["concurrent-fragments"], 4)),
    mergeFormat: values["merge-output-format"],
    remuxVideo: values["remux-video"],
    headers,
    limitRate,
  };
  for (const k of Object.keys(opts) as Array<keyof typeof opts>) if (opts[k] === undefined) delete opts[k];

  // Ctrl-C cancels in-flight work cleanly (partial .part files are kept for resume)
  const ctl = new AbortController();
  const onSigint = () => ctl.abort();
  process.once("SIGINT", onSigint);

  let code = 0;
  try {
    for (const url of urls) {
      try {
        const info = await tp.extract(url, { signal: ctl.signal });
        if (values["dump-json"]) process.stdout.write(JSON.stringify(info) + "\n");
        else if (values["list-formats"]) {
          log.tag("info", `Available formats for ${info.id}:`);
          process.stdout.write(listFormats(info) + "\n");
        } else if (values["get-url"]) {
          const chosen = tp.select(info, opts.format);
          if (!chosen) throw new TidepullError(`Requested format is not available: ${opts.format}`);
          for (const f of chosen) process.stdout.write(f.url + "\n");
        } else if (values.simulate) {
          log.tag("info", `${info.title} (${info.formats.length} format(s))`);
        } else if (archive?.has(info)) {
          log.tag("download", `${info.title}: already in the archive, skipping`);
        } else {
          const file = await tp.download(info, { ...opts, signal: ctl.signal });
          archive?.add(info);
          if (values["print-path"]) process.stdout.write(file + "\n");
        }
      } catch (e) {
        if (ctl.signal.aborted) {
          process.stderr.write("\n");
          log.error("Interrupted by user (partial files kept, re-run to resume)");
          if (values["progress-json"]) process.stdout.write(JSON.stringify({ type: "error", message: "interrupted", url }) + "\n");
          code = 130;
          break;
        }
        log.error(errMsg(e));
        if (values["progress-json"]) process.stdout.write(JSON.stringify({ type: "error", message: errMsg(e), url }) + "\n");
        if (values.verbose && e instanceof Error && e.stack) process.stderr.write(e.stack + "\n");
        code = Math.max(code, e instanceof TidepullError ? e.exitCode : 1);
      }
    }
  } finally {
    process.removeListener("SIGINT", onSigint);
  }
  return code;
}
