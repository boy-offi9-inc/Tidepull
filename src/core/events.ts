export type LogLevel = "debug" | "info" | "warn";

/** Everything the engine reports. Plain JSON-serializable objects, so they can be piped, logged or sent over IPC. */
export type TidepullEvent =
  | { type: "log"; level: LogLevel; tag?: string; message: string }
  | { type: "extract"; extractor: string; url: string }
  | { type: "start"; format_id: string; dest: string }
  | { type: "progress"; format_id: string; downloaded: number; total?: number; estimated?: boolean; speed?: number; eta?: number }
  | { type: "finish"; format_id: string; bytes: number; seconds: number; speed?: number }
  | { type: "merge"; output: string }
  | { type: "remux"; output: string }
  | { type: "done"; file: string }
  | { type: "error"; message: string; url?: string };

export type Emit = (e: TidepullEvent) => void;

/** What extractors see. Deliberately tiny. */
export interface Log {
  debug(msg: string): void;
  info(tag: string, msg: string): void;
  warn(msg: string): void;
}

export const makeLog = (emit: Emit): Log => ({
  debug: (message) => emit({ type: "log", level: "debug", message }),
  info: (tag, message) => emit({ type: "log", level: "info", tag, message }),
  warn: (message) => emit({ type: "log", level: "warn", message }),
});
