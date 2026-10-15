import type { TidepullEvent } from "../core/events.ts";
import { fmtBytes, fmtTime } from "./format.ts";
import type { Logger } from "./log.ts";

/** Human renderer: turns engine events into yt-dlp-style terminal output (stderr). Redraws one progress line on a TTY. */
export function humanRenderer(log: Logger, o: { progress: boolean; stream?: NodeJS.WriteStream }): (e: TidepullEvent) => void {
  const stream = o.stream ?? process.stderr;
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
        const pct = e.total ? `${((e.downloaded / e.total) * 100).toFixed(1).padStart(5)}%` : "";
        const size = e.total ? ` of ${e.estimated ? "~" : ""}${fmtBytes(e.total)}` : ` ${fmtBytes(e.downloaded)}`;
        const rate = e.speed ? ` at ${fmtBytes(e.speed)}/s` : "";
        const eta = e.eta !== undefined ? ` ETA ${fmtTime(e.eta)}` : "";
        stream.write(`\r\x1b[K[download] ${pct}${size}${rate}${eta}`);
        drawn = true;
        break;
      }
      case "finish":
        clear();
        log.tag("download", `100% of ${fmtBytes(e.bytes)} in ${fmtTime(e.seconds)}${e.speed ? ` at ${fmtBytes(e.speed)}/s` : ""}`);
        break;
      case "merge":
        log.tag("merger", `Merging formats into "${e.output}"`);
        break;
      case "remux":
        log.tag("remux", `Remuxing to "${e.output}"`);
        break;
      case "done":
        log.tag("done", e.file);
        break;
      case "error":
        clear();
        break;
    }
  };
}

/** Machine renderer: one JSON event per line on stdout (NDJSON). */
export const jsonRenderer = (): ((e: TidepullEvent) => void) => (e) => void process.stdout.write(JSON.stringify(e) + "\n");
