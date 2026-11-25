import assert from "node:assert/strict";
import { test } from "node:test";
import { renderBanner } from "../src/ui/banner.ts";
import { THEMES } from "../src/ui/theme.ts";

const bare = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

test("banner compresses plugin lists on narrow terminals", () => {
  const wide = bare(renderBanner("0.8.0", THEMES.tide, true, ["a", "b", "c", "d", "e"], 60));
  assert.match(wide, /a, b, c, d, e/);
  const narrow = bare(renderBanner("0.8.0", THEMES.tide, true, ["youtube", "soundcloud", "bandcamp", "dailymotion"], 40));
  const over = narrow.split("\n").filter((l) => l.length > 40);
  assert.equal(over.length, 0, `rows overflow 40 cols: ${over.map((l) => l.length).join(",")}`);
  assert.match(narrow, /youtube \+3/);
});

test("banner collapses to a title-only box below 30 columns", () => {
  for (const w of [14, 20, 24, 28]) {
    const out = bare(renderBanner("0.8.0", THEMES.tide, true, ["youtube"], w));
    const lines = out.split("\n");
    assert.ok(lines.length <= 2, `width ${w}: expected title-only box, got ${lines.length} lines`);
    assert.ok(lines.every((l) => l.length <= w), `width ${w}: overflow ${lines.map((l) => l.length).join(",")}`);
    assert.match(out, /tide|⬢/);
  }
});

test("banner fits every width from 10 to 120 columns", () => {
  for (let w = 10; w <= 120; w += 1) {
    const out = bare(renderBanner("0.8.0", THEMES.tide, true, ["youtube", "soundcloud"], w));
    for (const line of out.split("\n")) {
      assert.ok(line.length <= w, `width ${w}: line of ${line.length} cols`);
    }
  }
});
