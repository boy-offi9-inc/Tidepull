import { createCipheriv, randomBytes } from "node:crypto";
import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";

export interface Fixture {
  base: string;
  file: Buffer;
  plainSegs: Buffer[];
  noivSegs: Buffer[];
  files: Map<string, Buffer>;
  ranges: string[];
  seen: Array<{ path: string; headers: IncomingHttpHeaders }>;
  close(): Promise<void>;
}

const enc = (data: Buffer, key: Buffer, iv: Buffer) => {
  const c = createCipheriv("aes-128-cbc", key, iv);
  return Buffer.concat([c.update(data), c.final()]);
};

export async function startFixture(): Promise<Fixture> {
  const file = randomBytes(1024 * 1024);
  const key = randomBytes(16);
  const files = new Map<string, Buffer>([["/media/clip.mp4", file]]);
  const ranges: string[] = [];
  const seen: Array<{ path: string; headers: IncomingHttpHeaders }> = [];

  // playlist A: explicit IV; playlist B: no IV, media-sequence 5 => IV is the sequence number
  const plainSegs = Array.from({ length: 5 }, () => randomBytes(20000));
  const encSegs = plainSegs.map((s) => enc(s, key, Buffer.from("00000000000000000000000000000001", "hex")));
  const noivSegs = Array.from({ length: 4 }, () => randomBytes(15000));
  const noivEnc = noivSegs.map((s, i) => {
    const iv = Buffer.alloc(16);
    iv.writeUInt32BE(5 + i, 12);
    return enc(s, key, iv);
  });

  let flakyHits = 0;
  const mediaPl = `#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:4\n#EXT-X-MEDIA-SEQUENCE:0\n#EXT-X-KEY:METHOD=AES-128,URI="../key.bin",IV=0x00000000000000000000000000000001\n${encSegs
    .map((_, i) => `#EXTINF:4.0,\n../seg${i}.ts`)
    .join("\n")}\n#EXT-X-ENDLIST\n`;
  const noivPl = `#EXTM3U\n#EXT-X-TARGETDURATION:4\n#EXT-X-MEDIA-SEQUENCE:5\n#EXT-X-KEY:METHOD=AES-128,URI="key.bin"\n${noivEnc
    .map((_, i) => `#EXTINF:4.0,\nn${i}.ts`)
    .join("\n")}\n#EXT-X-ENDLIST\n`;
  const master = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360,CODECS="avc1.4d401e,mp4a.40.2"
low/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=2000000,RESOLUTION=1280x720,CODECS="avc1.640028,mp4a.40.2"
high/index.m3u8
`;
  const page = `<!doctype html><html><head><title>ignored</title>
<meta property="og:title" content="My &amp; Page">
<meta property="og:video" content="/media/clip.mp4"></head><body></body></html>`;

  const send = (res: import("node:http").ServerResponse, code: number, body: Buffer | string, type = "application/octet-stream") => {
    res.writeHead(code, { "content-type": type, "content-length": Buffer.byteLength(body) });
    res.end(body);
  };

  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    const p = url.pathname;
    seen.push({ path: p, headers: req.headers });
    if (p === "/flaky") return ++flakyHits === 1 ? send(res, 503, "busy") : send(res, 200, "ok", "text/plain");
    if (p === "/empty.html") return send(res, 200, "<html><title>x</title><body>nothing here</body></html>", "text/html");
    if (p === "/page-cross.html") {
      const v = url.searchParams.get("v") ?? "";
      return send(res, 200, `<!doctype html><title>Cross</title><meta property="og:video" content="${v}">`, "text/html");
    }
    if (p === "/page.html") return send(res, 200, page, "text/html");
    if (p === "/hls/master.m3u8") return send(res, 200, master, "application/vnd.apple.mpegurl");
    if (p === "/hls/high/index.m3u8" || p === "/hls/low/index.m3u8") return send(res, 200, mediaPl, "application/vnd.apple.mpegurl");
    if (p === "/hls/noiv.m3u8") return send(res, 200, noivPl, "application/vnd.apple.mpegurl");
    if (p === "/hls/key.bin") return send(res, 200, key);
    let m = /^\/hls\/seg(\d)\.ts$/.exec(p);
    if (m) return send(res, 200, encSegs[Number(m[1])]);
    m = /^\/hls\/n(\d)\.ts$/.exec(p);
    if (m) return send(res, 200, noivEnc[Number(m[1])]);

    if (p === "/echo") return send(res, 200, JSON.stringify(req.headers), "application/json");
    if (p === "/redir/to") {
      res.writeHead(302, { location: url.searchParams.get("u") ?? "/" });
      return void res.end();
    }
    if (p === "/redir/loop") {
      res.writeHead(302, { location: "/redir/loop" });
      return void res.end();
    }
    if (p === "/media/slow.mp4" && req.method === "HEAD") {
      res.writeHead(200, { "content-length": file.length, "content-type": "video/mp4" });
      return void res.end();
    }
    if (p === "/media/slow.mp4") {
      // 1 MiB delivered in 10 chunks, 100ms apart
      res.writeHead(200, { "content-length": file.length, "content-type": "video/mp4" });
      let i = 0;
      const t = setInterval(() => {
        res.write(file.subarray(i * 104858, Math.min((i + 1) * 104858, file.length)));
        if (++i === 10) {
          clearInterval(t);
          res.end(file.subarray(10 * 104858));
        }
      }, 100);
      res.on("close", () => clearInterval(t));
      return;
    }

    const nohead = p.startsWith("/nohead/");
    const buf = files.get(nohead ? p.replace("/nohead", "/media") : p);
    if (!buf) return send(res, 404, "nope", "text/plain");
    if (req.method === "HEAD") {
      if (nohead) return send(res, 405, "", "text/plain");
      res.writeHead(200, { "content-length": buf.length, "accept-ranges": "bytes", "content-type": "video/mp4" });
      return void res.end();
    }
    const r = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range ?? "");
    if (r) {
      ranges.push(req.headers.range!);
      const start = Number(r[1]);
      const end = r[2] ? Number(r[2]) : buf.length - 1;
      if (start >= buf.length) {
        res.writeHead(416, { "content-range": `bytes */${buf.length}` });
        return void res.end();
      }
      const chunk = buf.subarray(start, end + 1);
      res.writeHead(206, { "content-range": `bytes ${start}-${end}/${buf.length}`, "content-length": chunk.length, "content-type": "video/mp4" });
      return void res.end(chunk);
    }
    res.writeHead(200, { "content-length": buf.length, "content-type": "video/mp4" });
    res.end(buf);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  return {
    base: `http://127.0.0.1:${port}`,
    file,
    plainSegs,
    noivSegs,
    files,
    ranges,
    seen,
    close: () => new Promise<void>((r) => (server.closeAllConnections(), server.close(() => r()))),
  };
}
