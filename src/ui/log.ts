import type { Theme } from "./theme.ts";
import { getTheme } from "./theme.ts";

export interface LoggerOptions {
  quiet?: boolean;
  verbose?: boolean;
  color?: boolean;
  theme?: Theme | string;
}

/** Honors NO_COLOR / FORCE_COLOR, and only colors a real terminal. */
export function shouldUseColor(env: NodeJS.ProcessEnv = process.env, isTTY = !!process.stderr.isTTY): boolean {
  if (env.NO_COLOR) return false;
  if (env.FORCE_COLOR) return true;
  return isTTY && env.TERM !== "dumb";
}

/** All human-facing output goes to stderr. stdout is reserved for data you can pipe. */
export class Logger {
  quiet: boolean;
  verbose: boolean;
  color: boolean;
  theme: Theme;

  constructor(o: LoggerOptions = {}) {
    this.quiet = o.quiet ?? false;
    this.verbose = o.verbose ?? false;
    this.color = o.color ?? false;
    this.theme = typeof o.theme === "string" ? getTheme(o.theme) : (o.theme ?? getTheme(undefined));
  }
  private paint(c: string, s: string) {
    return this.color ? c + s + this.theme.reset : s;
  }
  tag(tag: string, msg: string) {
    if (!this.quiet) process.stderr.write(`${this.paint(this.theme.tag, `[${tag}]`)} ${msg}\n`);
  }
  debug(msg: string) {
    if (this.verbose) process.stderr.write(`${this.paint(this.theme.dim, "[debug]")} ${msg}\n`);
  }
  warn(msg: string) {
    process.stderr.write(`${this.paint(this.theme.warn, "WARNING:")} ${msg}\n`);
  }
  error(msg: string) {
    process.stderr.write(`${this.paint(this.theme.error, "ERROR:")} ${msg}\n`);
  }
}
