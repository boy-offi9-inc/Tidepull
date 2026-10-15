// tsc rewrites import extensions in .js output but not in .d.ts. Make declarations resolvable for consumers.
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const walk = (d) => readdirSync(d).flatMap((n) => {
  const p = path.join(d, n);
  return statSync(p).isDirectory() ? walk(p) : p.endsWith(".d.ts") ? [p] : [];
});
for (const f of walk("dist")) {
  const s = readFileSync(f, "utf8");
  const out = s.replace(/(from\s+|import\s*\(\s*)(["'])(\.{1,2}\/[^"']+)\.ts\2/g, "$1$2$3.js$2");
  if (out !== s) writeFileSync(f, out);
}
