import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { findFfmpeg, remux } from "../src/core/ffmpeg.ts";

test("ffmpeg: failures report ffmpeg's own diagnostics", { skip: !findFfmpeg() }, async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "tidepull-ff-"));
  try {
    const bad = path.join(dir, "garbage.ts");
    await writeFile(bad, Buffer.alloc(2048, 7));
    await assert.rejects(remux(findFfmpeg()!, bad, path.join(dir, "out.mp4")), /ffmpeg failed: .+garbage\.ts/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("ffmpeg: a missing binary is a clear error", async () => {
  await assert.rejects(remux("/definitely/not/ffmpeg", "a", "b"), /Failed to run ffmpeg/);
});
