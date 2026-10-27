"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "dist");
const port = Number(process.env.PORT || 2048);
const types = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml" };

const server = http.createServer((request, response) => {
  if (!["GET", "HEAD"].includes(request.method)) {
    response.writeHead(405, { Allow: "GET, HEAD" }).end("Method not allowed");
    return;
  }
  let pathname;
  try { pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname); }
  catch { response.writeHead(400).end("Bad request"); return; }
  const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const file = path.resolve(root, relative);
  if (file !== root && !file.startsWith(root + path.sep)) { response.writeHead(403).end("Forbidden"); return; }
  fs.stat(file, (error, stat) => {
    if (error || !stat.isFile()) { response.writeHead(404).end("Not found"); return; }
    response.writeHead(200, { "Content-Type": types[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
    if (request.method === "HEAD") { response.end(); return; }
    const stream = fs.createReadStream(file);
    stream.on("error", () => response.destroy());
    stream.pipe(response);
  });
});

server.on("error", (error) => {
  console.error(error.code === "EADDRINUSE" ? `端口 ${port} 已被占用，请设置 PORT 环境变量后重试。` : error.message);
  process.exitCode = 1;
});
server.listen(port, "127.0.0.1", () => { console.log(`一格 · 2048\nLocal: http://127.0.0.1:${port}`); });
