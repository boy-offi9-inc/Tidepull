import { spawn } from "node:child_process";
import { statSync } from "node:fs";
import path from "node:path";
import { TidepullError } from "./errors.ts";

export function findFfmpeg(location?: string): string | undefined {
  const exe = process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
  const isFile = (p: string) => {
    try {
      return statSync(p).isFile();
    } catch {
      return false;
    }
  };
  if (location) {
    if (isFile(location)) return location;
    const inDir = path.join(location, exe);
    return isFile(inDir) ? inDir : undefined;
  }
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    const p = path.join(dir, exe);
    if (dir && isFile(p)) return p;
  }
  return undefined;
}

function run(bin: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, ["-y", "-loglevel", "error", ...args], { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    p.stderr.on("data", (d: Buffer) => (err += d.toString()));
    p.on("error", (e) => reject(new TidepullError(`Failed to run ffmpeg: ${e.message}`)));
    p.on("close", (code) => (code === 0 ? resolve() : reject(new TidepullError(`ffmpeg failed: ${err.trim().split("\n").pop()}`))));
  });
}

export const mergeStreams = (bin: string, video: string, audio: string, out: string) =>
  run(bin, ["-i", video, "-i", audio, "-map", "0:v:0", "-map", "1:a:0", "-c", "copy", out]);

export const remux = (bin: string, input: string, out: string) => run(bin, ["-i", input, "-c", "copy", out]);
