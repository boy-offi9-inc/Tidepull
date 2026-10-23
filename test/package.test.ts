import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

test("package.json exposes the core and every opt-in entry point", async () => {
  const pkg = JSON.parse(await readFile("package.json", "utf8"));
  assert.deepEqual(Object.keys(pkg.exports).sort(), [".", "./cookies", "./dash", "./loader"]);
  for (const entry of Object.values<{ import: string; types: string }>(pkg.exports)) {
    assert.match(entry.import, /^\.\/dist\/.+\.js$/);
    assert.match(entry.types, /^\.\/dist\/.+\.d\.ts$/);
  }
});
