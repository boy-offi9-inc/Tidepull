import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import dash from "../src/dash/index.ts";
import { createTidepull, definePlugin, TidepullError } from "../src/index.ts";
import { loadPlugins, validatePlugin } from "../src/loader.ts";

let dir: string;
before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "tidepull-plug-"));
});
after(async () => {
  await rm(dir, { recursive: true, force: true });
});

test("plugins: loaded from file/dir, take priority, are validated", async () => {
  const pdir = path.join(dir, "plugins");
  await mkdir(pdir, { recursive: true });
  await writeFile(
    path.join(pdir, "site.mjs"),
    `export default {
       name: "demo", apiVersion: 1,
       extractors: [{
         name: "demosite",
         suitable: (u) => u.hostname === "demo.invalid",
         async extract(u, ctx) {
           ctx.log.debug("hello from plugin");
           return { id: "d1", title: "Demo", extractor: "demosite", webpage_url: u.href,
             formats: [{ format_id: "x", url: "https://demo.invalid/x.mp4", ext: "mp4", protocol: "https", vcodec: "unknown", acodec: "unknown" }] };
         } }] };`,
  );
  await writeFile(path.join(pdir, "bad.mjs"), `export default { name: "future", apiVersion: 99 };`);
  await assert.rejects(loadPlugins([pdir]), /apiVersion 99/);
  await rm(path.join(pdir, "bad.mjs"));

  const plugins = await loadPlugins([pdir]);
  assert.equal(plugins.length, 1);
  const g = createTidepull({ plugins });
  assert.deepEqual(g.extractors, ["demosite", "hls", "direct", "generic"]);
  const info = await g.extract("https://demo.invalid/watch");
  assert.equal(info.extractor, "demosite");

  // DASH is opt-in: absent by default, present (and first) when the plugin is passed
  assert.deepEqual(createTidepull().extractors, ["hls", "direct", "generic"]);
  assert.equal(createTidepull({ plugins: [dash] }).extractors[0], "dash");

  // .use() works at runtime too, and definePlugin is a typed identity
  const g2 = createTidepull().use(definePlugin({ name: "p2", apiVersion: 1, extractors: [{ name: "zzz", suitable: () => false, extract: async () => { throw new TidepullError("n/a"); } }] }));
  assert.equal(g2.extractors[0], "zzz");
  assert.throws(() => validatePlugin({ name: "x", apiVersion: 1, extractors: [{}] }, "t"), /every extractor/);
});
