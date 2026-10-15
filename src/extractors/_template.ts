/**
 * Template for a site plugin. You can keep this file out-of-tree: drop a copy (as .ts or .mjs) into
 * ~/.config/tidepull/plugins/ (or pass --plugin ./my-site.ts), no rebuild of tidepull needed.
 *
 *   import { definePlugin } from "tidepull";
 *
 * Contract:
 *   suitable(url)  cheap, synchronous, no network. Match on hostname/path.
 *   extract(url)   return an Info with >= 1 Format. Throw TidepullError for user-facing failures.
 *   apiVersion     must equal PLUGIN_API_VERSION, otherwise the loader refuses the plugin with a clear message.
 *
 * Format tips:
 *   vcodec/acodec = "none" when the track is absent ("unknown" when present but unidentified)
 *   protocol "https" = plain file, "hls" = .m3u8 media playlist (VOD, AES-128 ok)
 *   tbr / abr in kbit/s. height/width/fps feed the selector (bv*[height<=720] etc.)
 *   ctx.http is redirect-safe (cross-origin hops drop credentials) and honors cancellation; use it, not global fetch.
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
