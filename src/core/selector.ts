/**
 * Format selector syntax.
 *   b / best        best pre-merged format        bv / bestvideo   best video-only
 *   w / worst       worst pre-merged format       ba / bestaudio   best audio-only
 *   bv* / ba*       best with video / with audio  <format_id>      exact id
 *   a+b             merge two formats             a/b              fallback if a unavailable
 *   x[height<=720]  filters: <= >= < > = !=  (add ? after the op to also accept missing fields)
 *   (a/b)+c         grouping
 */
import type { Format } from "./types.ts";
import { TidepullError } from "./errors.ts";

export const DEFAULT_FORMAT = "bv*+ba/b";

interface Filter {
  field: string;
  op: string;
  value: string;
  optional: boolean;
}
type Node =
  | { kind: "fmt"; name: string; filters: Filter[] }
  | { kind: "merge"; parts: Node[] }
  | { kind: "alt"; options: Node[] };

function bad(sel: string, why: string): never {
  throw new TidepullError(`Invalid format selector "${sel}": ${why}`, 2);
}

export function parseSelector(sel: string): Node {
  let i = 0;
  const peek = () => sel[i];

  function alt(): Node {
    const options = [merge()];
    while (peek() === "/") {
      i++;
      options.push(merge());
    }
    return options.length === 1 ? options[0] : { kind: "alt", options };
  }
  function merge(): Node {
    const parts = [atom()];
    while (peek() === "+") {
      i++;
      parts.push(atom());
    }
    return parts.length === 1 ? parts[0] : { kind: "merge", parts };
  }
  function atom(): Node {
    if (peek() === "(") {
      i++;
      const n = alt();
      if (peek() !== ")") bad(sel, "missing )");
      i++;
      return n;
    }
    const start = i;
    while (i < sel.length && !"+/[()".includes(sel[i])) i++;
    const name = sel.slice(start, i).trim();
    if (!name) bad(sel, `expected a format name at position ${start}`);
    const filters: Filter[] = [];
    while (peek() === "[") {
      const end = sel.indexOf("]", i);
      if (end < 0) bad(sel, "missing ]");
      const m = /^\s*([a-z_]+)\s*(<=|>=|!=|<|>|=)\s*(\?)?\s*([^<>=!\s].*?)\s*$/.exec(sel.slice(i + 1, end));
      if (!m) bad(sel, `bad filter "${sel.slice(i, end + 1)}"`);
      filters.push({ field: m[1], op: m[2], value: m[4], optional: m[3] === "?" });
      i = end + 1;
    }
    return { kind: "fmt", name, filters };
  }

  const tree = alt();
  if (i < sel.length) bad(sel, `unexpected "${sel[i]}" at position ${i}`);
  return tree;
}

function parseNum(s: string): number | undefined {
  const m = /^(\d+(?:\.\d+)?)\s*([kmg])?i?b?$/i.exec(s);
  if (!m) return undefined;
  const unit = (m[2] ?? "").toLowerCase();
  const mult = unit === "k" ? 1024 : unit === "m" ? 1024 ** 2 : unit === "g" ? 1024 ** 3 : 1;
  return Number(m[1]) * mult;
}

function passes(f: Format, flt: Filter): boolean {
  const raw = (f as unknown as Record<string, unknown>)[flt.field];
  if (raw === undefined || raw === null) return flt.optional;
  const want = parseNum(flt.value);
  if (typeof raw === "number" && want !== undefined) {
    switch (flt.op) {
      case "<=": return raw <= want;
      case ">=": return raw >= want;
      case "<": return raw < want;
      case ">": return raw > want;
      case "=": return raw === want;
      case "!=": return raw !== want;
    }
  }
  const s = String(raw);
  if (flt.op === "=") return s === flt.value;
  if (flt.op === "!=") return s !== flt.value;
  return false;
}

const hasV = (f: Format) => f.vcodec !== "none";
const hasA = (f: Format) => f.acodec !== "none";

type Kind = "mux" | "v" | "v*" | "a" | "a*" | "any";
const ALIASES: Record<string, { kind: Kind; worst: boolean }> = {
  best: { kind: "mux", worst: false }, b: { kind: "mux", worst: false },
  worst: { kind: "mux", worst: true }, w: { kind: "mux", worst: true },
  "b*": { kind: "any", worst: false }, "w*": { kind: "any", worst: true },
  bestvideo: { kind: "v", worst: false }, bv: { kind: "v", worst: false }, "bv*": { kind: "v*", worst: false },
  worstvideo: { kind: "v", worst: true }, wv: { kind: "v", worst: true }, "wv*": { kind: "v*", worst: true },
  bestaudio: { kind: "a", worst: false }, ba: { kind: "a", worst: false }, "ba*": { kind: "a*", worst: false },
  worstaudio: { kind: "a", worst: true }, wa: { kind: "a", worst: true }, "wa*": { kind: "a*", worst: true },
};

function poolFor(kind: Kind, fs: Format[]): Format[] {
  switch (kind) {
    case "mux": {
      const m = fs.filter((f) => hasV(f) && hasA(f));
      return m.length ? m : fs.filter(hasV).length ? fs.filter(hasV) : fs;
    }
    case "v": return fs.filter((f) => hasV(f) && !hasA(f));
    case "v*": return fs.filter(hasV);
    case "a": return fs.filter((f) => hasA(f) && !hasV(f));
    case "a*": return fs.filter(hasA);
    default: return fs;
  }
}

function rank(f: Format, audio: boolean): number[] {
  return audio ? [f.abr ?? f.tbr ?? 0, f.tbr ?? 0] : [f.height ?? 0, f.fps ?? 0, f.tbr ?? 0];
}
function cmp(a: number[], b: number[]): number {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

function pick(name: string, filters: Filter[], all: Format[]): Format | undefined {
  const fs = all.filter((f) => filters.every((x) => passes(f, x)));
  const alias = ALIASES[name];
  if (!alias) return fs.find((f) => f.format_id === name);
  const pool = poolFor(alias.kind, fs);
  if (!pool.length) return undefined;
  const audio = alias.kind === "a" || alias.kind === "a*";
  let best = pool[0];
  for (const f of pool.slice(1)) {
    const c = cmp(rank(f, audio), rank(best, audio));
    if (alias.worst ? c < 0 : c >= 0) best = f;
  }
  return best;
}

function evaluate(n: Node, fs: Format[]): Format[] | undefined {
  switch (n.kind) {
    case "fmt": {
      const f = pick(n.name, n.filters, fs);
      return f ? [f] : undefined;
    }
    case "merge": {
      const out: Format[] = [];
      for (const p of n.parts) {
        const r = evaluate(p, fs);
        if (!r) return undefined;
        out.push(...r);
      }
      return out;
    }
    case "alt":
      for (const o of n.options) {
        const r = evaluate(o, fs);
        if (r) return r;
      }
      return undefined;
  }
}

/** Returns the chosen formats (2+ means "merge these"), or undefined if nothing matches. */
export function selectFormats(selector: string, formats: Format[]): Format[] | undefined {
  return evaluate(parseSelector(selector), formats);
}
