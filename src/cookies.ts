/**
 * Netscape cookies.txt support (opt-in: "@boy-offi9-inc/tidepull/cookies").
 * Cookies are sent only to the hosts, paths and schemes they were issued for, and are re-evaluated on every redirect hop.
 * Read-only: Set-Cookie responses are not stored. No public-suffix list: only a single-label domain guard.
 */
import { readFileSync, statSync } from "node:fs";
import { TidepullError, errMsg } from "./core/errors.ts";

export interface Cookie {
  domain: string;
  /** also valid for subdomains of `domain` */
  subdomains: boolean;
  path: string;
  secure: boolean;
  /** seconds since epoch, 0 for a session cookie */
  expires: number;
  name: string;
  value: string;
}

export function parseCookies(text: string): Cookie[] {
  const out: Cookie[] = [];
  for (const raw of text.split("\n")) {
    let line = raw.replace(/\r$/, "");
    if (!line.trim()) continue;
    if (line.startsWith("#HttpOnly_")) line = line.slice("#HttpOnly_".length);
    else if (line.startsWith("#")) continue;
    const f = line.split("\t");
    if (f.length < 6) continue;
    const [domain, flag, path, secure, expires, name, ...rest] = f;
    const bare = domain.replace(/^\./, "").toLowerCase();
    if (!bare || !name) continue;
    // A domain without a dot ("com") must not match every site under it.
    const subdomains = (flag.toUpperCase() === "TRUE" || domain.startsWith(".")) && bare.includes(".");
    out.push({ domain: bare, subdomains, path: path || "/", secure: secure.toUpperCase() === "TRUE", expires: Number(expires) || 0, name, value: rest.join("\t") });
  }
  return out;
}

const pathMatch = (reqPath: string, cookiePath: string) =>
  reqPath === cookiePath || (reqPath.startsWith(cookiePath) && (cookiePath.endsWith("/") || reqPath[cookiePath.length] === "/"));

/** The Cookie header value for `url`, or undefined when no cookie applies. */
export function cookieHeader(cookies: readonly Cookie[], url: URL, now = Date.now() / 1000): string | undefined {
  const host = url.hostname.toLowerCase();
  const isIp = /^[\d.]+$/.test(host) || host.includes(":");
  const hits = cookies.filter(
    (c) =>
      (host === c.domain || (c.subdomains && !isIp && host.endsWith("." + c.domain))) &&
      pathMatch(url.pathname || "/", c.path) &&
      (!c.secure || url.protocol === "https:") &&
      (c.expires === 0 || c.expires > now),
  );
  if (!hits.length) return undefined;
  return hits.sort((a, b) => b.path.length - a.path.length).map((c) => `${c.name}=${c.value}`).join("; ");
}

/** Plug into the HTTP client: `createTidepull({ http: { cookies: cookieJar(cookies) } })`. */
export const cookieJar =
  (cookies: readonly Cookie[]) =>
  (url: URL): string | undefined =>
    cookieHeader(cookies, url);

/** Reads a cookies.txt file. The warning (if any) says the file is readable by other users. */
export function loadCookieFile(file: string): { cookies: Cookie[]; warning?: string } {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (e) {
    throw new TidepullError(`Cannot read cookie file ${file}: ${errMsg(e)}`, 2);
  }
  const cookies = parseCookies(text);
  if (!cookies.length) throw new TidepullError(`No cookies found in ${file} (expected the Netscape cookies.txt format)`, 2);
  let warning: string | undefined;
  try {
    if (process.platform !== "win32" && (statSync(file).mode & 0o077) !== 0) warning = `${file} is readable by other users; run: chmod 600 ${file}`;
  } catch {
    /* permissions are advisory */
  }
  return { cookies, warning };
}
