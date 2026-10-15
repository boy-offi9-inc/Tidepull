export interface LoggerOptions {
  quiet?: boolean;
  verbose?: boolean;
  color?: boolean;
}

const C = { red: "\x1b[31m", yellow: "\x1b[33m", cyan: "\x1b[36m", dim: "\x1b[2m", reset: "\x1b[0m" };

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

  constructor(o: LoggerOptions = {}) {
    this.quiet = o.quiet ?? false;
    this.verbose = o.verbose ?? false;
    this.color = o.color ?? false;
  }
  private paint(c: string, s: string) {
    return this.color ? c + s + C.reset : s;
  }
  tag(tag: string, msg: string) {
    if (!this.quiet) process.stderr.write(`${this.paint(C.cyan, `[${tag}]`)} ${msg}\n`);
  }
  debug(msg: string) {
    if (this.verbose) process.stderr.write(`${this.paint(C.dim, "[debug]")} ${msg}\n`);
  }
  warn(msg: string) {
    process.stderr.write(`${this.paint(C.yellow, "WARNING:")} ${msg}\n`);
  }
  error(msg: string) {
    process.stderr.write(`${this.paint(C.red, "ERROR:")} ${msg}\n`);
  }
}
