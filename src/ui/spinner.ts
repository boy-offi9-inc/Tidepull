const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧"];

export interface SpinnerOptions {
  text?: string;
  stream?: NodeJS.WriteStream;
  env?: NodeJS.ProcessEnv;
  interval?: number;
}

/**
 * Single-line activity spinner on stderr. Never touches stdout, and never
 * starts at all when stderr is not a TTY or CI is detected: machine modes
 * must see zero bytes from it.
 */
export class Spinner {
  private timer: ReturnType<typeof setInterval> | undefined;
  private frame = 0;
  private text: string;
  private readonly stream: NodeJS.WriteStream;
  private readonly env: NodeJS.ProcessEnv;
  private readonly interval: number;

  constructor(o: SpinnerOptions = {}) {
    this.text = o.text ?? "extracting…";
    this.stream = o.stream ?? process.stderr;
    this.env = o.env ?? process.env;
    this.interval = o.interval ?? 80;
  }

  get active(): boolean {
    return this.timer !== undefined;
  }

  start(): this {
    if (this.timer || !this.stream.isTTY || this.env.CI) return this;
    this.render();
    this.timer = setInterval(() => {
      this.frame = (this.frame + 1) % FRAMES.length;
      this.render();
    }, this.interval);
    this.timer.unref();
    return this;
  }

  stop(finalLine?: string): this {
    if (!this.timer) return this;
    clearInterval(this.timer);
    this.timer = undefined;
    this.stream.write(`\r\x1b[K`);
    if (finalLine) {
      const dim = this.env.NO_COLOR ? "" : "\x1b[2m";
      this.stream.write(`${dim}${finalLine}\x1b[0m\n`);
    }
    return this;
  }

  private render(): void {
    this.stream.write(`\r\x1b[K${FRAMES[this.frame]} ${this.text}`);
  }
}
