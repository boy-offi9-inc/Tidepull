import type { Extractor } from "./core/types.ts";

/** Bump when the plugin contract changes in a breaking way. Plugins declare which version they target. */
export const PLUGIN_API_VERSION = 1;

export interface TidepullPlugin {
  name: string;
  apiVersion: number;
  extractors?: Extractor[];
}

/** Typed identity helper for plugin authors: `export default definePlugin({...})` */
export const definePlugin = (p: TidepullPlugin): TidepullPlugin => p;
