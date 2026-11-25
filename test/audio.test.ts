import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { extractAudio, findFfmpeg } from "../src/core/ffmpeg.ts";
import { TidepullError } from "../src/core/errors.ts";

test("audioCodec: unsupported format is rejected with the available list", async () => {
  const bin = findFfmpeg();
  if (!bin) return; // no ffmpeg on the machine: nothing to assert
  const dir = await mkdtemp(path.join(tmpdir(), "tp-audio-"));
  try {
    await assert.throws(
      () => extractAudio(bin, "/nonexistent/in.mp4", path.join(dir, "out.avi"), "avi"),
      (e: unknown) => e instanceof TidepullError && /Unsupported audio format: avi/.test((e as Error).message) && /mp3, m4a, opus/.test((e as Error).message),
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("extractAudio: produces a real audio file from a generated tone", async () => {
  const bin = findFfmpeg();
  if (!bin) return;
  const dir = await mkdtemp(path.join(tmpdir(), "tp-audio-"));
  try {
    // Generate a 1s sine-wave source with ffmpeg itself, then extract to mp3.
    const src = path.join(dir, "src.mp4");
    await new Promise<void>((resolve, reject) => {
      import("node:child_process").then(({ spawn }) => {
        const p = spawn(bin, ["-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=1", "-c:a", "aac", src]);
        p.on("close", (c) => (c === 0 ? resolve() : reject(new Error("source generation failed"))));
      });
    });
    const out = path.join(dir, "tone.mp3");
    await extractAudio(bin, src, out, "mp3");
    const files = await readdir(dir);
    assert.ok(files.includes("tone.mp3"), `expected tone.mp3 in ${files.join(", ")}`);
    const { statSync } = await import("node:fs");
    assert.ok(statSync(out).size > 1000, "mp3 output suspiciously small");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
