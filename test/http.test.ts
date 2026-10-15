import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { Http } from "../src/core/http.ts";
import { startFixture, type Fixture } from "./fixture.ts";

let a: Fixture;
let b: Fixture;

before(async () => {
  a = await startFixture();
  b = await startFixture();
});
after(async () => {
  await a.close();
  await b.close();
});

const echo = async (http: Http, url: string) => JSON.parse((await http.text(url)).text) as Record<string, string>;

test("redirects: secrets are dropped on cross-origin hops, kept on same-origin hops", async () => {
  const http = new Http({ headers: { Authorization: "Bearer s3cret", "X-Token": "t0k3n", Cookie: "sid=1" } });
  const cross = await echo(http, `${a.base}/redir/to?u=${encodeURIComponent(b.base + "/echo")}`);
  assert.equal(cross.authorization, undefined);
  assert.equal(cross["x-token"], undefined);
  assert.equal(cross.cookie, undefined);
  assert.ok(cross["user-agent"], "safe headers still travel");

  const same = await echo(http, `${a.base}/redir/to?u=${encodeURIComponent(a.base + "/echo")}`);
  assert.equal(same.authorization, "Bearer s3cret");
  assert.equal(same["x-token"], "t0k3n");
});

test("redirects: loops, and non-http(s) targets, are refused (and not retried)", async () => {
  const http = new Http({ retries: 3, maxRedirects: 5 });
  await assert.rejects(http.text(`${a.base}/redir/loop`), /Too many redirects/);
  await assert.rejects(http.text(`${a.base}/redir/to?u=${encodeURIComponent("file:///etc/passwd")}`), /Refusing redirect/);
});

test("headers: scoped mode sends secrets only to trusted origins / host patterns", async () => {
  const secret = { "X-Token": "t0k3n", Referer: "https://ref.example/" };
  const seenBy = async (http: Http, base: string) => (await echo(http, `${base}/echo`))["x-token"];

  const scoped = new Http({ headers: secret, headerHosts: [] });
  scoped.trust(a.base);
  assert.equal(await seenBy(scoped, a.base), "t0k3n");
  assert.equal(await seenBy(scoped, b.base), undefined, "untrusted origin gets no secret");
  assert.equal((await echo(scoped, `${b.base}/echo`)).referer, "https://ref.example/", "Referer is not secret");

  const byHost = new Http({ headers: secret, headerHosts: ["127.0.0.1"] });
  assert.equal(await seenBy(byHost, b.base), "t0k3n");
  assert.equal(await seenBy(new Http({ headers: secret, headerHosts: ["*.example.com"] }), b.base), undefined);
  assert.equal(await seenBy(new Http({ headers: secret }), a.base), "t0k3n", "low-level mode: start origin only");
});

test("http: retries 503", async () => {
  const { text } = await new Http({ retries: 2 }).text(`${a.base}/flaky`);
  assert.equal(text, "ok");
});
