/** Loads plugins from disk (Node only). Opt-in: `import { loadPlugins } from "@boy-offi9-inc/tidepull/loader"`. */
import { readdir, stat } from "node:fs/promises";
import { existsSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { TidepullError, errMsg } from "./core/errors.ts";
import { PLUGIN_API_VERSION, type TidepullPlugin } from "./plugins.ts";

export function validatePlugin(p: unknown, source: string): TidepullPlugin {
  if (!p || typeof p !== "object") throw new TidepullError(`Plugin ${source}: default export must be a plugin object (use definePlugin)`);
  const o = p as Partial<TidepullPlugin>;
  if (typeof o.name !== "string" || !o.name) throw new TidepullError(`Plugin ${source}: missing "name"`);
  if (o.apiVersion !== PLUGIN_API_VERSION) {
    throw new TidepullError(`Plugin "${o.name}" (${source}) targets apiVersion ${String(o.apiVersion)}, but this tidepull supports ${PLUGIN_API_VERSION}`);
  }
  for (const e of o.extractors ?? []) {
    if (!e || typeof e.name !== "string" || typeof e.suitable !== "function" || typeof e.extract !== "function") {
      throw new TidepullError(`Plugin "${o.name}" (${source}): every extractor needs name, suitable() and extract()`);
    }
  }
  return o as TidepullPlugin;
}

/** SECURITY: this executes the file's code with your privileges. Only load plugins you trust. */
export async function loadPlugin(file: string): Promise<TidepullPlugin> {
  let mod: { default?: unknown; plugin?: unknown };
  try {
    mod = await import(pathToFileURL(path.resolve(file)).href);
  } catch (e) {
    throw new TidepullError(`Failed to load plugin ${file}: ${errMsg(e)}`);
  }
  return validatePlugin(mod.default ?? mod.plugin, file);
}

const FILE_RE = /\.(?:m?js|cjs|mts|ts)$/;
const INDEX_RE = /^index\.(?:m?js|mts|ts)$/;

/**
 * Node emits a noisy MODULE_TYPELESS_PACKAGE_JSON warning for plugin files
 * in a directory without a package.json ("type": "module"). Tidepull plugins
 * are always ESM, so write that marker into the plugin dir once. The warning
 * is cosmetic either way — loading always worked. Disable with
 * TIDEPULL_NO_MODULE_FIX=1 (e.g. read-only config dirs).
 */
function ensureModuleType(dir: string): void {
  if (process.env.TIDEPULL_NO_MODULE_FIX) return;
  const pkg = path.join(dir, "package.json");
  if (existsSync(pkg)) return;
  try {
    writeFileSync(pkg, JSON.stringify({ type: "module" }) + "\n");
  } catch {
    // read-only dir etc. — cosmetic only, loading still works
  }
}

/** Each path may be a plugin file, or a directory of plugin files and/or `<name>/index.*` folders (not recursive). */
export async function loadPlugins(paths: string[]): Promise<TidepullPlugin[]> {
  const out: TidepullPlugin[] = [];
  for (const p of paths) {
    const s = await stat(p).catch(() => undefined);
    if (!s) throw new TidepullError(`Plugin path not found: ${p}`);
    if (s.isFile()) {
      out.push(await loadPlugin(p));
      continue;
    }
    ensureModuleType(p);
    for (const name of (await readdir(p)).sort()) {
      if (name.startsWith("_") || name.startsWith(".") || name.endsWith(".d.ts") || name === "package.json") continue;
      const full = path.join(p, name);
      const fs = await stat(full);
      if (fs.isFile() && FILE_RE.test(name)) out.push(await loadPlugin(full));
      else if (fs.isDirectory()) {
        const idx = (await readdir(full)).find((f) => INDEX_RE.test(f));
        if (idx) out.push(await loadPlugin(path.join(full, idx)));
      }
    }
  }
  return out;
}

export function defaultPluginDir(env: NodeJS.ProcessEnv = process.env): string {
  if (env.TIDEPULL_PLUGIN_DIR) return env.TIDEPULL_PLUGIN_DIR;
  return path.join(env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config"), "tidepull", "plugins");
}
