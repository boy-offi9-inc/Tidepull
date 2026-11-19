// Zero-dependency guard: the core may import only node: builtins and relative modules.
// usage: node scripts/lint-imports.mjs
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const ALLOWED = /^(node:[a-z_/]+|\.{1,2}\/[^"']+)$/;

const files = [];
const walkDir = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walkDir(p);
    else if (p.endsWith(".ts")) files.push(p);
  }
};
for (const r of ["src/core", "src/extractors"]) walkDir(r);
for (const name of readdirSync("src")) {
  const p = path.join("src", name);
  if (statSync(p).isFile() && p.endsWith(".ts")) files.push(p);
}

/** Pulls the quoted specifier out of a real import/export-from statement, once comments are gone. */
function stripComments(src) {
  let out = "";
  let i = 0;
  let block = false;
  while (i < src.length) {
    const ch = src[i];
    const next = src[i + 1];
    if (block) {
      if (ch === "*" && next === "/") (block = false), (i += 2);
      else i++;
      continue;
    }
    if (ch === "/" && next === "*") (block = true), (i += 2);
    else if (ch === "/" && next === "/") while (i < src.length && src[i] !== "\n") i++;
    else if (ch === '"' || ch === "'") {
      const q = ch;
      out += ch;
      i++;
      while (i < src.length && src[i] !== q) {
        if (src[i] === "\\") i++;
        out += src[i] ?? "";
        i++;
      }
      out += src[i] ?? "";
      i++;
    } else (out += ch), i++;
  }
  return out;
}

const STMT = /(?:^|[;\n])(?:import|export)\s+(?:type\s+)?(?:[\w*$,\s{}]+?\s+from\s+)?["']([^"']+)["']|(?:^|[;\n])import\s*\(\s*["']([^"']+)["']\s*\)/g;

const offenders = [];
let checked = 0;
for (const file of files.sort()) {
  checked++;
  const src = stripComments(readFileSync(file, "utf8"));
  for (const m of src.matchAll(STMT)) {
    const spec = m[1] ?? m[2];
    if (!ALLOWED.test(spec)) offenders.push({ file, spec });
  }
}

if (offenders.length) {
  for (const o of offenders) console.error(`${o.file}: imports "${o.spec}" (core allows only node: builtins and relative paths)`);
  console.error(`\n${offenders.length} non-stdlib import(s) in the zero-dependency core.`);
  process.exit(1);
}
console.log(`core import check: ${checked} files, all imports are node: builtins or relative`);
