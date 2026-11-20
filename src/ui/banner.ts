import type { Theme } from "./theme.ts";

const GLYPHS: Record<string, string[]> = {
  t: ["| |_ ", "| __|", "| |_ ", " \\__|"],
  i: ["|_ _|", " | | ", " | | ", "|___|"],
  d: ["  __| |", " / _` |", "| (_| |", " \\__,_|"],
  e: ["  ___ ", " / _ \\", "|  __/", " \\___|"],
  p: ["| '_ \\ ", "| |_) |", "| .__/ ", "|_|    "],
  u: ["| |   ", "| |   ", "| |   ", "|_|   "],
  l: ["| |", "| |", "| |", "|_|"],
};

/** Block-letter logo, assembled row by row so the letters are correct by construction. */
function logo(): string[] {
  const rows = ["", "", "", ""];
  for (const ch of "tidepull") {
    const g = GLYPHS[ch];
    for (let r = 0; r < 4; r++) rows[r] += g[r] + (r === 0 && ch !== "l" ? " " : " ");
  }
  return rows.map((r) => r.trimEnd());
}

/** Launch banner for interactive terminals; version dimmed beside the logo. */
export function renderBanner(version: string, theme: Theme, color = true): string {
  const plain = !color || !!process.env.NO_COLOR || theme.name === "mono";
  const paint = (c: string, s: string) => (plain ? s : c + s + theme.reset);
  const dim = (s: string) => (plain ? s : theme.dim + s + theme.reset);
  const rows = logo();
  rows[3] = paint(theme.accent, rows[3]) + "  " + dim(`v${version}`);
  return rows.map((r, i) => (i === 3 ? r : paint(theme.accent, r))).join("\n");
}
