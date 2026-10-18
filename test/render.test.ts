import assert from "node:assert/strict";
import { test } from "node:test";
import { Logger } from "../src/ui/log.ts";
import { humanRenderer } from "../src/ui/render.ts";

function fakeTty(columns: number) {
  const writes: string[] = [];
  const stream = { isTTY: true, columns, write: (s: string) => (writes.push(s), true) } as unknown as NodeJS.WriteStream;
  return { stream, writes };
}
const drawn = (writes: string[]) => writes.map((w) => w.replace("\r\x1b[K", ""));

test("progress line never reaches the terminal width (no wrapping, even on a phone)", () => {
  for (const cols of [20, 28, 37, 45, 80]) {
    const { stream, writes } = fakeTty(cols);
    const render = humanRenderer(new Logger({ quiet: true }), { progress: true, stream });
    render({ type: "progress", format_id: "x", downloaded: 1_234_567, total: 2_200_000, speed: 1_048_576, eta: 3725 });
    render({ type: "progress", format_id: "x", downloaded: 5, speed: 12 });
    for (const line of drawn(writes)) assert.ok(line.length < cols, `cols=${cols}: "${line}" (${line.length})`);
  }
});

test("progress: a wide terminal still gets the full line", () => {
  const { stream, writes } = fakeTty(120);
  humanRenderer(new Logger({ quiet: true }), { progress: true, stream })({ type: "progress", format_id: "x", downloaded: 1_000_000, total: 2_000_000, speed: 65_000, eta: 15 });
  assert.match(drawn(writes)[0], /^\[download\]\s+50\.0% of .+ at .+\/s ETA 00:15$/);
});

test("progress: nothing is drawn when output is not a TTY", () => {
  const writes: string[] = [];
  const stream = { isTTY: false, columns: 80, write: (s: string) => (writes.push(s), true) } as unknown as NodeJS.WriteStream;
  humanRenderer(new Logger({ quiet: true }), { progress: true, stream })({ type: "progress", format_id: "x", downloaded: 1, total: 2 });
  assert.equal(writes.length, 0);
});
