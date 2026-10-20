/** CLI-only helpers: config file, batch input, download archive, rate parsing. Not part of the library entry point. */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { TidepullError, errMsg } from "./core/errors.ts";
import type { Info } from "./core/types.ts";

/** "500K", "1.5M", "2G" or plain bytes per second. */
export function parseRate(s: string): number {
  const m = /^(\d+(?:\.\d+)?)([KMG])?$/i.exec(s.trim());
  if (!m || !(Number(m[1]) > 0)) throw new TidepullError(`Invalid rate "${s}" (examples: 500K, 1.5M)`, 2);
  const mult = { K: 1024, M: 1024 ** 2, G: 1024 ** 3 }[(m[2] ?? "").toUpperCase() as "K" | "M" | "G"] ?? 1;
  return Math.round(Number(m[1]) * mult);
}

/** Splits a config line into arguments. Supports 'single' and "double" quotes and \" inside double quotes. */
export function splitArgs(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quote = "";
  let started = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) {
      if (c === quote) quote = "";
      else if (c === "\\" && quote === '"' && i + 1 < line.length) cur += line[++i];
      else cur += c;
    } else if (c === '"' || c === "'") {
      quote = c;
      started = true;
    } else if (/\s/.test(c)) {
      if (cur || started) out.push(cur);
      cur = "";
      started = false;
    } else cur += c;
  }
  if (quote) throw new TidepullError(`Unterminated quote in: ${line}`, 2);
  if (cur || started) out.push(cur);
  return out;
}

/** One URL per line; blank lines and lines starting with # are ignored. "-" reads stdin. */
export function readUrlList(file: string): string[] {
  let text: string;
  try {
    text = readFileSync(file === "-" ? 0 : file, "utf8");
  } catch (e) {
    throw new TidepullError(`Cannot read batch file ${file}: ${errMsg(e)}`, 2);
  }
  return text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
}

export function defaultConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config"), "tidepull", "config");
}

/**
 * Arguments from the config file: one or more options per line, # starts a comment.
 * Placed before the command line so the command line wins. Returns [] when disabled or absent.
 */
export function configArgs(argv: string[], env: NodeJS.ProcessEnv = process.env): string[] {
  if (argv.includes("--no-config")) return [];
  const at = argv.findIndex((a) => a === "--config-location" || a.startsWith("--config-location="));
  let file: string | undefined;
  if (at >= 0) {
    const a = argv[at];
    file = a.includes("=") ? a.slice(a.indexOf("=") + 1) : argv[at + 1];
    if (!file || !existsSync(file)) throw new TidepullError(`Config file not found: ${file ?? "(no path given)"}`, 2);
  } else if (existsSync(defaultConfigPath(env))) file = defaultConfigPath(env);
  if (!file) return [];
  const out: string[] = [];
  for (const raw of readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (line && !line.startsWith("#")) out.push(...splitArgs(line));
  }
  return out;
}

/** Extractors whose ids are not globally unique (a file name, a playlist path): key them by URL instead. */
const BY_URL = new Set(["direct", "hls", "dash", "generic"]);

/** Remembers finished downloads so later runs skip them. One key per line. */
export class Archive {
  private file: string;
  private keys: Set<string>;

  constructor(file: string) {
    this.file = file;
    const lines = existsSync(file) ? readFileSync(file, "utf8").split(/\r?\n/) : [];
    this.keys = new Set(lines.map((l) => l.trim()).filter(Boolean));
  }
  static key(info: Info): string {
    return `${info.extractor} ${BY_URL.has(info.extractor) ? info.webpage_url : info.id}`;
  }
  has(info: Info): boolean {
    return this.keys.has(Archive.key(info));
  }
  add(info: Info): void {
    const key = Archive.key(info);
    if (this.keys.has(key)) return;
    mkdirSync(path.dirname(path.resolve(this.file)), { recursive: true });
    appendFileSync(this.file, key + "\n");
    this.keys.add(key);
  }
}
