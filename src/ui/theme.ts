/** Named ANSI color palettes for the CLI output. */
export interface Theme {
  name: string;
  tag: string;
  warn: string;
  error: string;
  dim: string;
  accent: string;
  progress: string;
  success: string;
  reset: string;
  /** Glyph used for the single-line progress redraw. */
  progressGlyph: string;
  /** Labels use bold instead of color when true (e.g. mono). */
  boldLabels: boolean;
}

const R = "\x1b[0m";

export const THEMES: Record<string, Theme> = {
  tide: {
    name: "tide", tag: "\x1b[36m", warn: "\x1b[33m", error: "\x1b[31m", dim: "\x1b[2m",
    accent: "\x1b[96m", progress: "\x1b[36m", success: "\x1b[92m", reset: R,
    progressGlyph: "\u2593", boldLabels: false,
  },
  mono: {
    name: "mono", tag: "\x1b[1m", warn: "\x1b[1m", error: "\x1b[1m", dim: "\x1b[2m",
    accent: "\x1b[1m", progress: "\x1b[1m", success: "\x1b[1m", reset: "\x1b[0m\x1b[22m",
    progressGlyph: "#", boldLabels: true,
  },
  "high-contrast": {
    name: "high-contrast", tag: "\x1b[97m", warn: "\x1b[93;1m", error: "\x1b[91;1m", dim: "\x1b[97m",
    accent: "\x1b[96;1m", progress: "\x1b[96;1m", success: "\x1b[92;1m", reset: R,
    progressGlyph: "\u2588", boldLabels: true,
  },
  amber: {
    name: "amber", tag: "\x1b[33m", warn: "\x1b[33;1m", error: "\x1b[31;1m", dim: "\x1b[2m",
    accent: "\x1b[93m", progress: "\x1b[93m", success: "\x1b[92m", reset: R,
    progressGlyph: "\u2593", boldLabels: false,
  },
};

export const THEME_NAMES = Object.keys(THEMES);

/** Resolves a theme name; throws with the available names when unknown. */
export function getTheme(name: string | undefined): Theme {
  const key = name ?? "tide";
  const t = THEMES[key];
  if (!t) throw new Error(`Unknown theme "${key}". Available themes: ${THEME_NAMES.join(", ")}`);
  return t;
}

/** --theme flag wins over TIDEPULL_THEME; neither means the default. */
export function pickTheme(flag: string | undefined, env: NodeJS.ProcessEnv = process.env): Theme {
  return getTheme(flag ?? env.TIDEPULL_THEME);
}
