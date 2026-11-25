import type { Theme } from "./theme.ts";

const GLYPH = "\u2b22"; // hex glyph, HexForge-family branding

const visible = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "").length;

/** Terminal width: TTY reports it; fall back to 80 when unknown. */
function termWidth(): number {
  return process.stdout.columns ?? 80;
}

/** Info column: dim key / bright value pairs, one per row. */
function infoRows(version: string, theme: Theme, plain: boolean, plugins: string[]): Array<[string, string]> {
  const dim = (s: string) => (plain ? s : theme.dim + s + theme.reset);
  const ok = (s: string) => (plain ? s : theme.success + s + theme.reset);
  const tag = (s: string) => (plain ? s : theme.tag + s + theme.reset);
  const rows: Array<[string, string]> = [
    ["media downloader", ok(`v${version}`)],
    ["stdout", ok("data only")],
  ];
  rows.push(["plugins", plugins.length ? tag(plugins.join(", ")) : dim("none")]);
  return rows;
}

/**
 * Launch banner: a dash-border box in the HexForge Gateway style —
 * `⬢ tidepull vX.Y.Z` in the top border, labeled stat rows inside, and
 * the listening/palette details as plain rows under it. Width-fitted to
 * the terminal; NO_COLOR / mono / non-color render fully plain.
 */
export function renderBanner(version: string, theme: Theme, color = true, plugins: string[] = [], width?: number): string {
  const plain = !color || !!process.env.NO_COLOR || theme.name === "mono";
  const paint = (c: string, s: string) => (plain ? s : c + s + theme.reset);
  const accent = (s: string) => paint(theme.accent, s);
  const dim = (s: string) => paint(theme.dim, s);
  const w = Math.max(24, Math.min(width ?? termWidth(), 60));

  const rows = infoRows(version, theme, plain, plugins);
  const LABEL = Math.max(...rows.map(([k]) => k.length)) + 2;
  const inner = w - 2;

  const lines: string[] = [];

  // Top border with the title embedded: ┌── title ─────┐ (plain: +--+ style dashes).
  const title = `${GLYPH} tidepull` + (plain ? ` v${version}` : ` ${paint(theme.dim, `v${version}`)}`);
  const shownTitle = visible(title) > inner - 4 ? `${GLYPH} tidepull` : title;
  const dash = "\u2500";
  const fill = Math.max(1, inner - visible(shownTitle) - 4);
  lines.push(
    accent("\u250c\u2500" + " ") + shownTitle + " " + accent(" " + dash.repeat(fill) + "\u2510"),
  );

  // Stat rows inside the box.
  for (const [key, value] of rows) {
    const pad = Math.max(0, inner - 2 - LABEL - visible(value));
    lines.push(accent("\u2502") + " " + dim(key.padEnd(LABEL)) + value + " ".repeat(pad) + " " + accent("\u2502"));
  }

  // Bottom border.
  lines.push(accent("\u2514" + dash.repeat(inner) + "\u2518"));

  return lines.join("\n");
}

/** Kept for compatibility with earlier callers/tests that imported it. */
export const _visibleWidth = visible;
export { termWidth };
