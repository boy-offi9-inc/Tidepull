import { test } from "node:test";
import assert from "node:assert/strict";
import { Logger, sanitizeLog } from "../src/ui/log.ts";

function capture(fn: (l: Logger) => void): string {
  const orig = process.stderr.write;
  let out = "";
  process.stderr.write = ((chunk: unknown) => { out += String(chunk); return true; }) as typeof process.stderr.write;
  try {
    fn(new Logger({ verbose: true, color: false }));
  } finally {
    process.stderr.write = orig;
  }
  return out;
}

test("sanitizeLog strips ANSI escapes and control chars from remote text", () => {
  assert.equal(sanitizeLog("\x1b[31mred\x1b[0m"), "red");
  assert.equal(sanitizeLog("evil\x1b]0;win-title\x07ok"), "evilok");
  assert.equal(sanitizeLog("a\rb\nc"), "a b c");
  assert.equal(sanitizeLog("bell\x07!"), "bell !");
  assert.equal(sanitizeLog("del\x7fx"), "del x");
  assert.equal(sanitizeLog("normal title [2026]"), "normal title [2026]");
});

test("Logger.tag/warn/error sanitize remote-supplied messages", () => {
  const out = capture((l) => {
    l.tag("download", "Destination: \x1b[31m\x1b[0m/x/EVIL\rINJECTED");
    l.warn("title with \x07 bel\x1b]2;t\x07l");
    l.error("\x1b[2Kerase-and-fake-prompt>");
    l.debug("\x1b[1;32mfake success\x1b[0m");
  });
  assert.ok(!out.includes("\x1b[31m"), "no SGR passthrough");
  assert.ok(!out.includes("\x1b]2;"), "no OSC passthrough");
  assert.ok(!out.includes("\x1b[2K"), "no erase passthrough");
  assert.ok(!out.includes("\x07"), "no bell passthrough");
  assert.ok(!out.includes("\r"), "no CR passthrough");
  assert.ok(out.includes("INJECTED"), "readable text kept");
});
