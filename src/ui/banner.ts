import type { Theme } from "./theme.ts";

const GLYPH = "\u2b22"; // hex glyph, HexForge-family branding

const visible = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "").length;

/** Terminal width: TTY reports it; fall back to 80 when unknown. */
function termWidth(): number {
  return process.stdout.columns ?? 80;
}

/** Info column: dim key / bright value pairs, one per row. Values that would
 *  push the row past the box are compressed (plugin lists truncate with …). */
function infoRows(version: string, theme: Theme, plain: boolean, plugins: string[], valueRoom: number): Array<[string, string]> {
  const dim = (s: string) => (plain ? s : theme.dim + s + theme.reset);
  const ok = (s: string) => (plain ? s : theme.success + s + theme.reset);
  const tag = (s: string) => (plain ? s : theme.tag + s + theme.reset);
  const fit = (s: string, plain_s: string): string => {
    if (visible(plain_s) <= valueRoom) return s;
    // Drop plugins from the tail until the row fits, then mark the cut.
    if (plugins.length > 1 && plain_s === plugins.join(", ")) {
      let names = plugins;
      do {
        names = names.slice(0, -1);
        const body = names.join(", ") + ` +${plugins.length - names.length}`;
        if (visible(body) <= valueRoom) return tag(body);
      } while (names.length > 1);
      // Even one name + count is too wide: hard-truncate with an ellipsis.
      const one = plugins[0].slice(0, Math.max(1, valueRoom - 1)) + "\u2026";
      return tag(one);
    }
    return s;
  };
  const rows: Array<[string, string]> = [
    ["media downloader", ok(`v${version}`)],
    ["stdout", ok("data only")],
  ];
  const pluginValue = plugins.length ? plugins.join(", ") : "";
  if (plugins.length) {
    rows.push(["plugins", fit(tag(pluginValue), pluginValue)]);
  } else {
    rows.push(["plugins", dim("none")]);
  }
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
  // Narrower than the labeled rows can render → title-only box (the version
  // rides the top border). 30 columns is the full-box minimum.
  const w = Math.min(width ?? termWidth(), 60);
  const inner = w - 2;
  const LABEL = 17; // "media downloader" + gap
  if (inner - 2 - LABEL < 10) {
    // Title itself may not fit: compress to the glyphs' width budget.
    const full = `${GLYPH} tidepull ${version}`;
    const title = visible(full) > inner - 5
      ? full.slice(0, Math.max(1, inner - 6)) + "\u2026"
      : full;
    const dash = "\u2500";
    const fill = Math.max(1, inner - visible(title) - 4);
    return [
      accent("\u250c\u2500" + " ") + title + " " + accent(" " + dash.repeat(fill) + "\u2510"),
      accent("\u2514" + dash.repeat(inner) + "\u2518"),
    ].join("\n");
  }
  const rows = infoRows(version, theme, plain, plugins, inner - 2 - LABEL);

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
