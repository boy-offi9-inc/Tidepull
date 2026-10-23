import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { Http } from "../src/core/http.ts";
import { cookieHeader, cookieJar, loadCookieFile, parseCookies } from "../src/cookies.ts";
import { createTidepull } from "../src/index.ts";
import { startFixture, type Fixture } from "./fixture.ts";

const line = (...f: Array<string | number>) => f.join("\t");
const exit2 = (e: Error & { exitCode?: number }) => e.exitCode === 2;

const jar = parseCookies(
  [
    "# Netscape HTTP Cookie File",
    "",
    line(".example.com", "TRUE", "/", "FALSE", 0, "sid", "abc"),
    line("host.test", "FALSE", "/", "FALSE", 0, "only", "host"),
    line("#HttpOnly_.example.com", "TRUE", "/app", "TRUE", 0, "tok", "s3"),
    line(".example.com", "TRUE", "/", "FALSE", 1, "expired", "x"),
    line(".com", "TRUE", "/", "FALSE", 0, "wide", "bad"),
    line("example.com", "TRUE", "/path", "FALSE", 0, "p", "1"),
    line(".empty.test", "TRUE", "/", "FALSE", 0, "e", ""),
    "not a cookie line",
  ].join("\n"),
);
const header = (url: string) => cookieHeader(jar, new URL(url));

test("parse: comments, HttpOnly prefix, empty values and junk lines", () => {
  assert.deepEqual(jar.map((c) => c.name), ["sid", "only", "tok", "expired", "wide", "p", "e"]);
  assert.equal(jar.find((c) => c.name === "tok")?.domain, "example.com");
  assert.equal(jar.find((c) => c.name === "e")?.value, "");
});

test("match: domain, subdomains, host-only cookies and the single-label guard", () => {
  assert.equal(header("https://www.example.com/x"), "sid=abc");
  assert.equal(header("https://example.com/x"), "sid=abc");
  assert.equal(header("https://notexample.com/x"), undefined);
  assert.equal(header("http://host.test/"), "only=host");
  assert.equal(header("http://sub.host.test/"), undefined);
  assert.equal(header("https://evil.com/"), undefined, 'a ".com" cookie must not match every .com site');
  assert.equal(header("http://a.empty.test/"), "e=");
});

test("match: path boundaries, Secure, expiry and ordering", () => {
  assert.equal(header("https://example.com/app/page"), "tok=s3; sid=abc", "longer paths first");
  assert.equal(header("http://example.com/app"), "sid=abc", "Secure cookies are never sent over http");
  assert.equal(header("https://example.com/application"), "sid=abc", "/app must not match /application");
  assert.equal(header("https://example.com/path/x"), "p=1; sid=abc");
  assert.equal(header("https://example.com/pathology"), "sid=abc");
  assert.ok(!header("https://example.com/")?.includes("expired"));
  assert.equal(cookieHeader(jar, new URL("https://example.com/"), 0.5)?.includes("expired"), true, "not yet expired at t=0.5s");
});

let dir: string;
let fx: Fixture;
before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "tidepull-cookies-"));
  fx = await startFixture();
});
after(async () => {
  await fx.close();
  await rm(dir, { recursive: true, force: true });
});

test("file: loading, errors and the permissions warning", { skip: process.platform === "win32" }, async () => {
  const f = path.join(dir, "cookies.txt");
  await writeFile(f, line(".a.test", "TRUE", "/", "FALSE", 0, "k", "v") + "\n");
  await chmod(f, 0o644);
  assert.match(loadCookieFile(f).warning ?? "", /chmod 600/);
  await chmod(f, 0o600);
  assert.equal(loadCookieFile(f).warning, undefined);
  assert.equal(loadCookieFile(f).cookies.length, 1);
  await writeFile(path.join(dir, "empty.txt"), "# nothing here\n");
  assert.throws(() => loadCookieFile(path.join(dir, "empty.txt")), exit2);
  assert.throws(() => loadCookieFile(path.join(dir, "missing.txt")), exit2);
});

test("http: cookies go only to the matching host and are re-evaluated on every redirect hop", async () => {
  const port = new URL(fx.base).port;
  const http = new Http({ cookies: cookieJar(parseCookies(line("localhost", "FALSE", "/", "FALSE", 0, "sid", "abc"))) });
  const echo = async (u: string) => JSON.parse((await http.text(u)).text) as Record<string, string>;
  const to = (u: string) => `/redir/to?u=${encodeURIComponent(u)}`;
  assert.equal((await echo(`http://localhost:${port}/echo`)).cookie, "sid=abc");
  assert.equal((await echo(`http://127.0.0.1:${port}/echo`)).cookie, undefined);
  assert.equal((await echo(`http://127.0.0.1:${port}${to(`http://localhost:${port}/echo`)}`)).cookie, "sid=abc", "the new host's cookie joins at the redirect");
  assert.equal((await echo(`http://localhost:${port}${to(`http://127.0.0.1:${port}/echo`)}`)).cookie, undefined, "the cookie does not follow a redirect to another host");
});

test("http: the jar replaces a hand-written Cookie header only where it applies", async () => {
  const port = new URL(fx.base).port;
  const http = new Http({ headers: { Cookie: "manual=1" }, cookies: cookieJar(parseCookies(line("localhost", "FALSE", "/", "FALSE", 0, "sid", "abc"))) });
  const echo = async (u: string) => JSON.parse((await http.text(u)).text) as Record<string, string>;
  assert.equal((await echo(`http://localhost:${port}/echo`)).cookie, "sid=abc");
  assert.equal((await echo(`http://127.0.0.1:${port}/echo`)).cookie, "manual=1");
});

test("library: a login-protected file needs the cookie", async () => {
  const url = `${fx.base}/private/clip.mp4`;
  await assert.rejects(createTidepull().pull(url, { paths: dir, output: "nologin.%(ext)s" }), /403/);
  const cookies = parseCookies(line("127.0.0.1", "FALSE", "/", "FALSE", 0, "session", "s3cr3t9f3a"));
  const tp = createTidepull({ http: { cookies: cookieJar(cookies) } });
  const file = await tp.pull(url, { paths: dir, output: "login.%(ext)s" });
  const { readFile } = await import("node:fs/promises");
  assert.ok((await readFile(file)).equals(fx.file));
});
