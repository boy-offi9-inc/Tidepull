/** Public library API. Everything not exported here is internal. */
export { Tidepull, createTidepull } from "./tidepull.ts";
export type { TidepullOptions, CallOptions, Listener } from "./tidepull.ts";

export { definePlugin, PLUGIN_API_VERSION } from "./plugins.ts";
export type { TidepullPlugin } from "./plugins.ts";

export type { Info, Format, Extractor, Ctx, Protocol } from "./core/types.ts";
export type { TidepullEvent, Log } from "./core/events.ts";
export type { DownloadOptions } from "./core/pipeline.ts";
export type { HttpOptions } from "./core/http.ts";

export { Http } from "./core/http.ts";
export { TidepullError } from "./core/errors.ts";
export { selectFormats, DEFAULT_FORMAT } from "./core/selector.ts";
export { renderTemplate, sanitize } from "./core/template.ts";
export { parseMaster as parseHlsMaster, parseMedia as parseHlsMedia } from "./core/hls.ts";
