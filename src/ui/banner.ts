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

/** Per-letter color stops for the gradient sweep (8 letters, theme-matched). */
function gradientStops(theme: Theme): string[] {
  switch (theme.name) {
    case "amber":
      // amber → deep orange sweep
      return ["\x1b[93m", "\x1b[93m", "\x1b[33m", "\x1b[33m", "\x1b[33;1m", "\x1b[31m", "\x1b[31;1m", "\x1b[31;1m"];
    case "high-contrast":
      // bold cyan → bold white sweep
      return ["\x1b[96;1m", "\x1b[96;1m", "\x1b[96;1m", "\x1b[97;1m", "\x1b[97;1m", "\x1b[97;1m", "\x1b[97;1m", "\x1b[97;1m"];
    case "tide":
      // cyan → green "tide coming in" sweep
      return ["\x1b[96m", "\x1b[96m", "\x1b[36m", "\x1b[36m", "\x1b[36m", "\x1b[92m", "\x1b[92m", "\x1b[92m"];
    default:
      return [];
  }
}

/** Block-glyph logo, assembled row by row so the letters are correct by construction. */
function logo(): string[] {
  const rows = ["", "", ""];
  for (const ch of "tidepull") {
    const g = GLYPHS[ch];
    for (let r = 0; r < 3; r++) rows[r] += g[r];
  }
  return rows.map((r) => r.trimEnd());
}

/** Info column: dim key / bright value pairs, fastfetch-style stat rows. */
function infoLines(version: string, theme: Theme, plain: boolean): string[] {
  const dim = (s: string) => (plain ? s : theme.dim + s + theme.reset);
  const ok = (s: string) => (plain ? s : theme.success + s + theme.reset);
  return [
    dim("media downloader"),
    `${dim("version")}  ${ok(`v${version}`)}`,
    `${dim("stdout")}   ${ok("data only")}`,
  ];
}

/** Launch banner: gradient block-glyph logo + fastfetch-style info column, side by side. */
export function renderBanner(version: string, theme: Theme, color = true): string {
  const plain = !color || !!process.env.NO_COLOR || theme.name === "mono";
  const paint = (c: string, s: string) => (plain ? s : c + s + theme.reset);
  const rows = logo();

  if (plain) {
    rows[2] += "  v" + version;
    return rows.join("\n");
  }

  const stops = gradientStops(theme);
  // Letter column ranges in the assembled logo (before trimEnd), for per-letter paint.
  const starts = [0, 5, 9, 14, 19, 24, 29, 34];
  const widths = [5, 4, 5, 5, 5, 5, 5, 5];
  const painted: string[] = ["", "", ""];
  for (let li = 0; li < 8; li++) {
    const c = stops[li] ?? theme.accent;
    for (let r = 0; r < 3; r++) {
      painted[r] += paint(c, rows[r].slice(starts[li], starts[li] + widths[li]));
    }
  }
  for (let r = 0; r < 3; r++) painted[r] = painted[r].trimEnd() + theme.reset;
  // paint() already appended reset per segment; trailing spaces carry resets — harmless.

  const info = infoLines(version, theme, plain);
  const visible = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "").length;
  const lines: string[] = [];
  for (let r = 0; r < 3; r++) {
    const pad = Math.max(2, 42 - visible(painted[r]));
    lines.push(painted[r] + " ".repeat(pad) + (info[r] ?? ""));
  }
  return lines.join("\n");
}
