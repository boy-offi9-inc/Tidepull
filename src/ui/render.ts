import type { TidepullEvent } from "../core/events.ts";
import { fmtBytes, fmtTime } from "./format.ts";
import type { Logger } from "./log.ts";
import type { Theme } from "./theme.ts";
import { getTheme } from "./theme.ts";

/** Renders engine events as terminal output on stderr, redrawing one progress line on a TTY. */
export function humanRenderer(
  log: Logger,
  o: { progress: boolean; stream?: NodeJS.WriteStream; theme?: Theme | string },
): (e: TidepullEvent) => void {
  const stream = o.stream ?? process.stderr;
  const theme = typeof o.theme === "string" ? getTheme(o.theme) : (o.theme ?? log.theme);
  const colorize = (c: string, s: string) => (log.color ? c + s + theme.reset : s);
  const live = o.progress && !!stream.isTTY;
  let drawn = false;
  const clear = () => {
    if (drawn) stream.write("\r\x1b[K");
    drawn = false;
  };

  return (e) => {
    switch (e.type) {
      case "log":
        clear();
        if (e.level === "debug") log.debug(e.message);
        else if (e.level === "warn") log.warn(e.message);
        else log.tag(e.tag ?? "info", e.message);
        break;
      case "extract":
        log.tag(e.extractor, `Extracting URL: ${e.url}`);
        break;
      case "start":
        log.tag("download", `Destination: ${e.dest}`);
        break;
      case "progress": {
        if (!live) break;
        const cols = stream.columns || 80;
        const pct = e.total ? `${((e.downloaded / e.total) * 100).toFixed(1).padStart(5)}%` : "";
        const size = e.total ? ` of ${e.estimated ? "~" : ""}${fmtBytes(e.total)}` : ` ${fmtBytes(e.downloaded)}`;
        const rate = e.speed ? ` at ${fmtBytes(e.speed)}/s` : "";
        const eta = e.eta !== undefined ? ` ETA ${fmtTime(e.eta)}` : "";
        // Keep the line narrower than the terminal: a wrapped line cannot be redrawn in place.
        let line = `[download] ${pct}${size}${rate}${eta}`;
        if (line.length >= cols) line = `[download] ${pct}${size}${rate}`;
        if (line.length >= cols) line = `${pct}${size}${rate}`.trim();
        if (line.length >= cols) line = `${pct}${size}`.trim();
        if (line.length >= cols) line = (pct || fmtBytes(e.downloaded)).trim();
        stream.write(`\r\x1b[K${colorize(theme.progress, line.slice(0, Math.max(1, cols - 1)))}`);
        drawn = true;
        break;
      }
      case "finish":
        clear();
        log.tag("download", colorize(theme.success, `100% of ${fmtBytes(e.bytes)} in ${fmtTime(e.seconds)}${e.speed ? ` at ${fmtBytes(e.speed)}/s` : ""}`));
        break;
      case "merge":
        log.tag("merger", `Merging formats into "${e.output}"`);
        break;
      case "remux":
        log.tag("remux", `Remuxing to "${e.output}"`);
        break;
      case "playlist":
        log.tag("playlist", `${e.title}: ${e.selected} of ${e.count} item(s)`);
        break;
      case "item":
        log.tag("item", `${e.position}/${e.total}${e.title ? ` ${e.title}` : ""}`);
        break;
      case "done":
        log.tag("done", colorize(theme.success, e.file));
        break;
      case "error":
        clear();
        break;
    }
  };
}

/** Writes one JSON event per line to stdout (NDJSON). */
export const jsonRenderer = (): ((e: TidepullEvent) => void) => (e) => void process.stdout.write(JSON.stringify(e) + "\n");
