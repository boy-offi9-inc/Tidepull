// Footprint check: bytes of JS reachable from an entry file (what a consumer actually loads), raw + gzip.
// usage: node scripts/size.mjs dist/index.js [--budget=KB]
import { readFileSync } from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";

const entry = process.argv[2] ?? "dist/index.js";
const budget = Number((process.argv.find((a) => a.startsWith("--budget=")) ?? "").split("=")[1]) || undefined;
const seen = new Map();
const walk = (file) => {
  file = path.resolve(file);
  if (seen.has(file)) return;
  const src = readFileSync(file, "utf8");
  seen.set(file, src);
  for (const m of src.matchAll(/(?:from|import)\s*\(?\s*["'](\.{1,2}\/[^"']+)["']/g)) walk(path.resolve(path.dirname(file), m[1]));
};
walk(entry);
const all = [...seen.values()].join("\n");
const raw = Buffer.byteLength(all);
const gz = gzipSync(all).length;
const rows = [...seen].map(([f, s]) => [path.relative(process.cwd(), f), Buffer.byteLength(s)]).sort((a, b) => b[1] - a[1]);
if (process.argv.includes("--files")) for (const [f, n] of rows) console.log(String(n).padStart(7), f);
console.log(`${entry}: ${seen.size} files, ${(raw / 1024).toFixed(1)} KB raw, ${(gz / 1024).toFixed(1)} KB gzip`);
if (budget && raw / 1024 > budget) {
  console.error(`over budget: ${(raw / 1024).toFixed(1)} KB > ${budget} KB`);
  process.exit(1);
}
