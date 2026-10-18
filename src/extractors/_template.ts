/**
 * Template for a site plugin. Copy it to ~/.config/tidepull/plugins/ (as .ts or .mjs) or load it with --plugin; no rebuild needed.
 *
 *   import { definePlugin } from "@boy-offi9-inc/tidepull";
 *
 * Contract:
 *   suitable(url)  cheap and synchronous, no network; match on hostname or path.
 *   extract(url)   return an Info with at least one Format; throw TidepullError for user-facing failures.
 *   apiVersion     must equal PLUGIN_API_VERSION, otherwise the loader rejects the plugin.
 *
 * Formats:
 *   vcodec/acodec: "none" when the track is absent, "unknown" when present but unidentified.
 *   protocol: "https" for a plain file, "hls" for an .m3u8 media playlist (VOD, AES-128).
 *   tbr/abr are in kbit/s; height, width and fps feed the selector (bv*[height<=720] etc.).
 *   Use ctx.http rather than global fetch: it applies the redirect and header-scoping rules and honors cancellation.
 */
import { TidepullError } from "../core/errors.ts";
import { definePlugin } from "../plugins.ts";

export default definePlugin({
  name: "example",
  apiVersion: 1,
  extractors: [
    {
      name: "example",
      suitable: (url) => url.hostname === "example.com" && url.pathname.startsWith("/watch/"),
      async extract(url, ctx) {
        const { text } = await ctx.http.text(url.href);
        const src = /"videoUrl":"([^"]+)"/.exec(text)?.[1];
        if (!src) throw new TidepullError("Could not find the video URL on the page");
        return {
          id: url.pathname.split("/").pop() ?? "video",
          title: /<title>([^<]*)<\/title>/.exec(text)?.[1] ?? "video",
          extractor: "example",
          webpage_url: url.href,
          formats: [{ format_id: "http", url: new URL(src, url).href, ext: "mp4", protocol: "https", vcodec: "unknown", acodec: "unknown" }],
        };
      },
    },
  ],
});
