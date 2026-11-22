import assert from "node:assert/strict";
import { test } from "node:test";
import { getTheme, pickTheme, THEMES, THEME_NAMES } from "../src/ui/theme.ts";
import { Logger, shouldUseColor } from "../src/ui/log.ts";
import { humanRenderer } from "../src/ui/render.ts";

test("theme selection precedence: flag beats env beats default", () => {
  assert.equal(pickTheme("amber", { TIDEPULL_THEME: "mono" }).name, "amber");
  assert.equal(pickTheme(undefined, { TIDEPULL_THEME: "mono" }).name, "mono");
  assert.equal(pickTheme(undefined, {}).name, "tide");
  assert.equal(getTheme(undefined).name, "tide");
});

test("unknown theme fails with the available names", () => {
  assert.throws(() => getTheme("neon"), (e: Error) => {
    for (const n of THEME_NAMES) assert.ok(e.message.includes(n));
    return e.message.includes("neon");
  });
});

test("NO_COLOR strips colors even when a theme is set", () => {
  const env = { NO_COLOR: "1", FORCE_COLOR: "1" };
  assert.equal(shouldUseColor(env, true), false);
  const log = new Logger({ color: shouldUseColor(env, true), theme: THEMES.amber });
  assert.equal(log.theme.name, "amber");
  const writes: string[] = [];
  const stream = { isTTY: true, columns: 80, write: (s: string) => (writes.push(s), true) } as unknown as NodeJS.WriteStream;
  const render = humanRenderer(log, { progress: true, stream, theme: THEMES.amber });
  render({ type: "progress", format_id: "x", downloaded: 1, total: 2 });
  assert.ok(!writes.some((w) => w.includes("\x1b[9")), "no color codes when color is off");
});

test("themes apply to Logger and renderer output", () => {
  const log = new Logger({ color: true, theme: THEMES.mono });
  const writes: string[] = [];
  const orig = process.stderr.write.bind(process.stderr);
  process.stderr.write = ((s: string) => (writes.push(s), true)) as typeof process.stderr.write;
  try {
    log.tag("info", "hello");
    log.warn("careful");
    const stream = { isTTY: true, columns: 80, write: (s: string) => (writes.push(s), true) } as unknown as NodeJS.WriteStream;
    const render = humanRenderer(new Logger({ color: true, theme: THEMES.tide }), { progress: true, stream, theme: THEMES.tide });
    render({ type: "progress", format_id: "x", downloaded: 500_000, total: 1_000_000 });
    render({ type: "done", file: "out.mp4" });
  } finally {
    process.stderr.write = orig as typeof process.stderr.write;
  }
  assert.ok(writes[0].startsWith("\x1b[1m[info]\x1b[0m\x1b[22m"), `mono bold tag: ${JSON.stringify(writes[0])}`);
  assert.ok(writes[1].startsWith("\x1b[1mWARNING:"), `mono bold warn: ${JSON.stringify(writes[1])}`);
  assert.ok(writes[2].includes("\x1b[36m"), `tide progress colored: ${JSON.stringify(writes[2])}`);
  const done = writes[writes.length - 1];
  assert.ok(done.includes("\x1b[36m[done]") && done.includes("out.mp4"), `tide success colored: ${JSON.stringify(done)}`);
});

test("each theme has a distinct progress glyph and all tokens are ANSI strings", () => {
  assert.equal(THEMES.tide.progressGlyph, "\u2593");
  assert.equal(THEMES.mono.progressGlyph, "#");
  for (const name of THEME_NAMES) {
    const t = getTheme(name);
    for (const token of ["tag", "warn", "error", "dim", "accent", "progress", "success"] as const) {
      assert.ok(t[token].startsWith("\x1b["), `${name}.${token}`);
    }
    assert.ok(t.progressGlyph.length > 0);
  }
});
