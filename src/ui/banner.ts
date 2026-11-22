import type { Theme } from "./theme.ts";

/** 3-row block glyphs. Every letter is exactly 5 columns (4 glyph + 1 gap); `i` is 4. */
const GLYPHS: Record<string, string[]> = {
  t: ["▀█▀  ", " █   ", " ▀   "],
  i: ["█   ", "█   ", "▀   "],
  d: ["█▀▀▄ ", "█  █ ", "▀▀▀▀ "],
  e: ["█▀▀▀ ", "█▀▀  ", "▀▀▀▀ "],
  p: ["█▀▀▄ ", "█▀▀  ", "▀  ▀ "],
  u: ["█  █ ", "█  █ ", "▀▀▀▀ "],
  l: ["█    ", "█    ", "▀▀▀▀ "],
};

/** Block-glyph logo, assembled row by row so the letters are correct by construction. */
function logo(): string[] {
  const rows = ["", "", ""];
  for (const ch of "tidepull") {
    const g = GLYPHS[ch];
    for (let r = 0; r < 3; r++) rows[r] += g[r];
  }
  return rows.map((r) => r.trimEnd());
}

/** Launch banner for interactive terminals; version dimmed beside the logo. */
export function renderBanner(version: string, theme: Theme, color = true): string {
  const plain = !color || !!process.env.NO_COLOR || theme.name === "mono";
  const paint = (c: string, s: string) => (plain ? s : c + s + theme.reset);
  const dim = (s: string) => (plain ? s : theme.dim + s + theme.reset);
  const rows = logo();
  rows[2] = paint(theme.accent, rows[2]) + " " + dim(`v${version}`);
  return rows.map((r, i) => (i === 2 ? r : paint(theme.accent, r))).join("\n");
}
