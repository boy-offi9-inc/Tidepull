import type { Extractor } from "../core/types.ts";
import type { TidepullPlugin } from "../plugins.ts";
import { directExtractor } from "./direct.ts";
import { genericExtractor } from "./generic.ts";
import { hlsExtractor } from "./hls.ts";

export const builtinExtractors: readonly Extractor[] = [hlsExtractor, directExtractor, genericExtractor];

/** First `suitable()` match wins: plugin extractors (in order), then built-ins, with the generic fallback always last. */
export function buildRegistry(plugins: readonly TidepullPlugin[] = []): Extractor[] {
  const specific = builtinExtractors.filter((e) => e !== genericExtractor);
  return [...plugins.flatMap((p) => p.extractors ?? []), ...specific, genericExtractor];
}
