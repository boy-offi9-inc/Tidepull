import assert from "node:assert/strict";
import { test } from "node:test";
import { renderBanner } from "../src/ui/banner.ts";
import { THEMES } from "../src/ui/theme.ts";

test("banner contains the version string", () => {
  assert.match(renderBanner("0.4.2", THEMES.tide), /v0\.4\.2/);
});

test("banner fits a 60-column terminal", () => {
  for (const line of renderBanner("0.9.99", THEMES.tide).replace(/\x1b\[[0-9;]*m/g, "").split("\n")) {
    assert.ok(line.length <= 60, `line too wide: ${line.length}`);
  }
});

test("banner respects NO_COLOR: no ANSI escapes at all", () => {
  const env = { ...process.env, NO_COLOR: "1" };
  const saved = process.env.NO_COLOR;
  process.env.NO_COLOR = "1";
  try {
    const out = renderBanner("0.4.2", THEMES.tide);
    assert.ok(!out.includes("\x1b["), "banner emitted ANSI with NO_COLOR");
  } finally {
    if (saved === undefined) delete process.env.NO_COLOR;
    else process.env.NO_COLOR = saved;
  }
  void env;
});

test("mono theme renders plain (no color codes)", () => {
  const saved = process.env.NO_COLOR;
  delete process.env.NO_COLOR;
  try {
    assert.ok(!renderBanner("0.4.2", THEMES.mono).includes("\x1b[3"));
  } finally {
    if (saved !== undefined) process.env.NO_COLOR = saved;
  }
});

test("banner is three logo rows (extras fold below)", () => {
  const out = renderBanner("0.4.2", THEMES.tide);
  const lines = out.split("\n");
  assert.equal(lines.length, 4); // 3 logo rows + wave divider
});
