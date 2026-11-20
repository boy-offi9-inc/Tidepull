import assert from "node:assert/strict";
import { test } from "node:test";
import { Spinner } from "../src/ui/spinner.ts";

function fakeStream(isTTY: boolean) {
  const writes: string[] = [];
  return {
    writes,
    stream: { isTTY, columns: 80, write: (s: string) => (writes.push(s), true) } as unknown as NodeJS.WriteStream,
  };
}

test("spinner never starts when stderr is not a TTY", () => {
  const { stream, writes } = fakeStream(false);
  new Spinner({ stream, env: {} }).start();
  assert.deepEqual(writes, []);
});

test("spinner never starts under CI env even on a TTY", () => {
  const { stream, writes } = fakeStream(true);
  new Spinner({ stream, env: { CI: "1" } }).start();
  assert.deepEqual(writes, []);
});

test("spinner draws frames then clears the line on stop", async () => {
  const { stream, writes } = fakeStream(true);
  const s = new Spinner({ stream, env: {}, interval: 10, text: "extracting…" });
  s.start();
  assert.ok(s.active);
  await new Promise((r) => setTimeout(r, 50));
  s.stop();
  assert.ok(!s.active);
  assert.ok(writes[0].includes("⠋ extracting…"));
  assert.ok(writes.some((w) => w.includes("⠋")), "frames cycled");
  assert.ok(writes.at(-1)!.includes("\r\x1b[K"), "stop clears the line");
});

test("stop leaves an optional dim final line", () => {
  const { stream, writes } = fakeStream(true);
  const s = new Spinner({ stream, env: {} });
  s.start();
  s.stop("3 item(s)");
  assert.ok(writes.at(-1)!.includes("3 item(s)"));
});

test("spinner writes zero bytes to stdout ever", () => {
  const stdoutWrites: string[] = [];
  const orig = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: unknown) => (stdoutWrites.push(String(chunk)), true)) as typeof process.stdout.write;
  try {
    const { stream } = fakeStream(true);
    const s = new Spinner({ stream, env: {}, interval: 5 });
    s.start().stop("done");
  } finally {
    process.stdout.write = orig;
  }
  assert.deepEqual(stdoutWrites, []);
});

test("NO_COLOR suppresses the dim escape on the final line", () => {
  const { stream, writes } = fakeStream(true);
  const s = new Spinner({ stream, env: { NO_COLOR: "1" } });
  s.start().stop("done");
  assert.ok(!writes.join("").includes("\x1b[2m"));
});
