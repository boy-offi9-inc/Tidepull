import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { Archive, configArgs, parseRate, readUrlList, splitArgs } from "../src/cliutil.ts";
import type { Info } from "../src/core/types.ts";

let dir: string;
before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "tidepull-cliutil-"));
});
after(async () => {
  await rm(dir, { recursive: true, force: true });
});

const exit2 = (e: Error & { exitCode?: number }) => e.exitCode === 2;

test("parseRate: units, and invalid values are usage errors", () => {
  assert.equal(parseRate("500K"), 512_000);
  assert.equal(parseRate("1.5M"), 1_572_864);
  assert.equal(parseRate("2g"), 2_147_483_648);
  assert.equal(parseRate("4096"), 4096);
  for (const bad of ["", "abc", "0", "-5K", "1T", "5 K"]) assert.throws(() => parseRate(bad), exit2, bad);
});

test("splitArgs: quotes, escapes, empty arguments", () => {
  assert.deepEqual(splitArgs('-o "%(title)s [%(id)s].%(ext)s"'), ["-o", "%(title)s [%(id)s].%(ext)s"]);
  assert.deepEqual(splitArgs("--header 'X-Token: a b'"), ["--header", "X-Token: a b"]);
  assert.deepEqual(splitArgs('"a \\"q\\" b" plain'), ['a "q" b', "plain"]);
  assert.deepEqual(splitArgs('--user-agent ""'), ["--user-agent", ""]);
  assert.deepEqual(splitArgs("   "), []);
  assert.throws(() => splitArgs('-o "oops'), exit2);
});

test("readUrlList: skips blanks and comments, trims, reports unreadable files", async () => {
  const f = path.join(dir, "urls.txt");
  await writeFile(f, "# list\n\n  https://a.test/1.mp4  \r\nhttps://a.test/2.m3u8\n# https://skipped.test\n");
  assert.deepEqual(readUrlList(f), ["https://a.test/1.mp4", "https://a.test/2.m3u8"]);
  assert.throws(() => readUrlList(path.join(dir, "missing.txt")), exit2);
});

test("configArgs: explicit file, = form, default location, --no-config, missing file", async () => {
  const f = path.join(dir, "tp.conf");
  await writeFile(f, '# defaults\n\n-P "/tmp/out dir"\n--limit-rate 1M --no-progress\n');
  const expected = ["-P", "/tmp/out dir", "--limit-rate", "1M", "--no-progress"];
  assert.deepEqual(configArgs(["--config-location", f, "url"]), expected);
  assert.deepEqual(configArgs([`--config-location=${f}`]), expected);
  assert.deepEqual(configArgs(["--no-config", "--config-location", f]), []);

  const xdg = path.join(dir, "xdg");
  await mkdir(path.join(xdg, "tidepull"), { recursive: true });
  await writeFile(path.join(xdg, "tidepull", "config"), "-q\n");
  assert.deepEqual(configArgs(["url"], { XDG_CONFIG_HOME: xdg }), ["-q"]);
  assert.deepEqual(configArgs(["url"], { XDG_CONFIG_HOME: path.join(dir, "empty") }), []);
  assert.throws(() => configArgs(["--config-location", path.join(dir, "nope.conf")]), exit2);
  assert.throws(() => configArgs(["--config-location"]), exit2);
});

const info = (extractor: string, id: string, webpage_url: string): Info => ({ id, title: id, extractor, webpage_url, formats: [] });

test("Archive: keys, persistence and no duplicates", async () => {
  const file = path.join(dir, "nested", "archive.txt");
  const a = new Archive(file);
  const direct = info("direct", "clip", "https://one.test/clip.mp4");
  const site = info("site", "123", "https://x.test/v/123?utm=1");
  assert.equal(a.has(direct), false);
  a.add(direct);
  a.add(direct);
  a.add(site);
  assert.equal(await readFile(file, "utf8"), "direct https://one.test/clip.mp4\nsite 123\n");

  const b = new Archive(file); // a new run sees the previous one
  assert.equal(b.has(direct), true);
  assert.equal(b.has(info("direct", "clip", "https://two.test/clip.mp4")), false, "same file name on another host is a different item");
  assert.equal(b.has(info("site", "123", "https://x.test/other-url")), true, "site extractors are keyed by id, not URL");
});
