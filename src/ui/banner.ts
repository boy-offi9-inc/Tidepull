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
function infoLines(version: string, theme: Theme, plain: boolean, plugins: string[]): string[] {
  const dim = (s: string) => (plain ? s : theme.dim + s + theme.reset);
  const ok = (s: string) => (plain ? s : theme.success + s + theme.reset);
  const tag = (s: string) => (plain ? s : theme.tag + s + theme.reset);
  const rows = [dim("media downloader"), `${dim("version")}  ${ok(`v${version}`)}`, `${dim("stdout")}   ${ok("data only")}`];
  if (plugins.length) rows.push(`${dim("plugins")}  ${tag(plugins.join(", "))}`);
  return rows;
}

/** Terminal width: TTY reports it; fall back to 80 when unknown. */
function termWidth(): number {
  return process.stdout.columns ?? 80;
}

const visible = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "").length;

/** Layout decision, computed from content + terminal width — nothing hardcoded.
 *  side  : logo left, info right (needs logoW + gap + maxInfoW <= width)
 *  stack : info rows UNDER the logo (narrow terminals, long plugin lists)  */
function chooseLayout(logoWidth: number, infoWidths: number[], width: number): "side" | "stack" {
  const maxInfo = Math.max(...infoWidths);
  return logoWidth + 3 + maxInfo <= width - 1 ? "side" : "stack";
}

/** Launch banner: gradient block-glyph logo + fastfetch-style info column.
 *  Auto-layouts from the real terminal width: side-by-side when it fits,
 *  stacked info below the logo on narrow phones. `plugins` adds the flex row.
 *  `width` overrides the detected terminal width (tests, forced layouts). */
export function renderBanner(version: string, theme: Theme, color = true, plugins: string[] = [], width?: number): string {
  const plain = !color || !!process.env.NO_COLOR || theme.name === "mono";
  const paint = (c: string, s: string) => (plain ? s : c + s + theme.reset);
  const rows = logo();
  const logoWidth = Math.max(...rows.map((r) => r.length));
  const info = infoLines(version, theme, plain, plugins);
  const infoWidths = info.map(visible);
  const w = width ?? termWidth();
  const layout = chooseLayout(logoWidth, infoWidths, w);

  // Paint the gradient logo once, for both layouts.
  let painted: string[];
  if (plain) {
    painted = rows;
  } else {
    const stops = gradientStops(theme);
    const starts = [0, 5, 9, 14, 19, 24, 29, 34];
    const widths = [5, 4, 5, 5, 5, 5, 5, 5];
    painted = ["", "", ""];
    for (let li = 0; li < 8; li++) {
      const c = stops[li] ?? theme.accent;
      for (let r = 0; r < 3; r++) painted[r] += paint(c, rows[r].slice(starts[li], starts[li] + widths[li]));
    }
    for (let r = 0; r < 3; r++) painted[r] = painted[r].trimEnd() + theme.reset;
  }

  const lines: string[] = [];
  if (layout === "side") {
    // Info column starts just past the widest logo row + gap; never hardcode.
    const col = logoWidth + 4;
    for (let r = 0; r < 3; r++) {
      const pad = Math.max(2, col - visible(painted[r]));
      lines.push(painted[r] + " ".repeat(pad) + (info[r] ?? ""));
    }
    for (let r = 3; r < info.length; r++) lines.push(" ".repeat(col + 1) + info[r]);
  } else {
    // Stack: logo rows first, then info lines indented to align with the logo.
    lines.push(...painted);
    for (const row of info) lines.push("  " + row);
  }

  // Wave divider under everything, width-fitted — the tide motif.
  const tag = plain ? "" : theme.tag;
  const span = layout === "side" ? logoWidth + 4 + infoWidths[0] : logoWidth;
  const waves = Math.max(6, Math.min(30, span - 1));
  lines.push(paint(tag, " " + "≈".repeat(waves)));
  return lines.join("\n");
}
