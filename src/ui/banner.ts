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

const LOGO_COLS = 42; // info column starts here

/** Info column: dim key / bright value pairs, fastfetch-style stat rows.
 *  Row 0 doubles as the tagline row; the version rides whichever row is free. */
function infoLines(version: string, theme: Theme, plain: boolean, plugins: string[]): string[] {
  const dim = (s: string) => (plain ? s : theme.dim + s + theme.reset);
  const ok = (s: string) => (plain ? s : theme.success + s + theme.reset);
  const tag = (s: string) => (plain ? s : theme.tag + s + theme.reset);
  const rows = [dim("media downloader"), `${dim("version")}  ${ok(`v${version}`)}`, `${dim("stdout")}   ${ok("data only")}`];
  if (plugins.length) rows.push(`${dim("plugins")}  ${tag(plugins.join(", "))}`);
  return rows;
}

/** Launch banner: gradient block-glyph logo + fastfetch-style info column, side by side.
 *  `plugins` (auto-detected, optional) adds a `plugins` stat row — the flex line. */
export function renderBanner(version: string, theme: Theme, color = true, plugins: string[] = []): string {
  const plain = !color || !!process.env.NO_COLOR || theme.name === "mono";
  const paint = (c: string, s: string) => (plain ? s : c + s + theme.reset);
  const rows = logo();

  if (plain) {
    const info = infoLines(version, theme, true, plugins);
    // 4 info rows but a 3-row logo: fold the plugins row under the logo.
    const fold = info.length > 3 ? `${info[3]}  v${version}` : undefined;
    const shown = info.slice(0, 3);
    if (fold) shown[2] = shown[2]; // stdout row stays; fold goes below
    const lines: string[] = [];
    for (let r = 0; r < 3; r++) {
      const pad = Math.max(2, LOGO_COLS - rows[r].length);
      lines.push(rows[r] + " ".repeat(pad) + (shown[r] ?? ""));
    }
    if (fold) lines.push(" ".repeat(LOGO_COLS + 2) + `${info[3]}`);
    return lines.join("\n");
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

  const info = infoLines(version, theme, plain, plugins);
  const visible = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "").length;
  const lines: string[] = [];
  for (let r = 0; r < 3; r++) {
    const pad = Math.max(2, LOGO_COLS - visible(painted[r]));
    lines.push(painted[r] + " ".repeat(pad) + (info[r] ?? ""));
  }
  if (info.length > 3) lines.push(" ".repeat(LOGO_COLS + 2) + info[3]);
  // Wave divider, tucked under the logo — the tide motif.
  const waveStr = " ≈≈≈≈≈≈≈≈≈≈≈";
  lines.push(paint(plain ? "" : theme.tag, waveStr));
  return lines.join("\n");
}
