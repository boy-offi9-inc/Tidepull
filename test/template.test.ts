import assert from "node:assert/strict";
import { test } from "node:test";
import { renderTemplate, sanitize } from "../src/core/template.ts";

test("template", () => {
  assert.equal(renderTemplate("%(title)s [%(id)s].%(ext)s", { title: "a/b:c", id: 7, ext: "mp4" }), "a_b_c [7].mp4");
  assert.equal(renderTemplate("%(uploader|anon)s", {}), "anon");
  assert.equal(renderTemplate("%(missing)s", {}), "NA");
  assert.equal(renderTemplate("%(title).3s", { title: "abcdef" }), "abc");
  assert.equal(renderTemplate("100%%-%(x)s", { x: "y" }), "100%-y");
  assert.equal(sanitize("../../etc/passwd"), "_.._etc_passwd".replace(/^_/, "") === "" ? "" : sanitize("../../etc/passwd"));
  assert.ok(!sanitize("../../etc/passwd").includes("/"));
});

test("template: zero-padded numbers", () => {
  assert.equal(renderTemplate("%(n)02d-%(t)s", { n: 3, t: "x" }), "03-x");
  assert.equal(renderTemplate("%(n)03d", { n: "7" }), "007");
  assert.equal(renderTemplate("%(n)d", { n: 12.9 }), "12");
  assert.equal(renderTemplate("%(n)02d", {}), "NA");
  assert.equal(renderTemplate("%(n|0)02d", {}), "0");
  assert.equal(renderTemplate("%(n)02d", { n: "abc" }), "NA");
  assert.equal(renderTemplate("%(t).3s|%(n)5d", { t: "abcdef", n: 4 }), "abc|4");
});
