// dsh-anywhere-web 隧道反代：纯透传 127.0.0.1:3090 → 127.0.0.1:3080。
// Host/Origin 改写已由插件 dsh-anywhere-web 在 dsh 内部完成（白名单），
// 本反代只做 HTTP + WebSocket 透传，不改任何头。
import http from "node:http";

const PORT = Number(process.env.LISTEN_PORT || 3090);
const BIND_HOST = process.env.BIND_HOST || "127.0.0.1";
const UPSTREAM_HOST = process.env.UPSTREAM_HOST || "127.0.0.1";
const UPSTREAM_PORT = Number(process.env.UPSTREAM_PORT || 3080);

const server = http.createServer((req, res) => {
  const opts = {
    host: UPSTREAM_HOST,
    port: UPSTREAM_PORT,
    method: req.method,
    path: req.url,
    headers: { ...req.headers },
  };
  const proxy = http.request(opts, (up) => {
    res.writeHead(up.statusCode, up.headers);
    up.pipe(res);
  });
  proxy.on("error", (e) => {
    res.writeHead(502);
    res.end(`proxy error: ${e.message}`);
  });
  req.pipe(proxy);
});

server.on("upgrade", (req, socket, head) => {
  const opts = {
    host: UPSTREAM_HOST,
    port: UPSTREAM_PORT,
    method: req.method,
    path: req.url,
    headers: { ...req.headers },
  };
  const proxy = http.request(opts);
  proxy.on("upgrade", (upRes, upSocket, upHead) => {
    socket.write("HTTP/1.1 101 Switching Protocols\r\n");
    for (const [k, v] of Object.entries(upRes.headers)) {
      if (typeof v === "string") socket.write(`${k}: ${v}\r\n`);
    }
    socket.write("\r\n");
    socket.write(upHead);
    upSocket.write(head);
    socket.pipe(upSocket);
    upSocket.pipe(socket);
  });
  proxy.on("error", () => socket.destroy());
  proxy.end();
});

server.listen(PORT, BIND_HOST, () =>
  console.log(`dsh-anywhere-web tunnel-proxy: ${BIND_HOST}:${PORT} -> ${UPSTREAM_HOST}:${UPSTREAM_PORT}`)
);
