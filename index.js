// dsh-anywhere-web — 服务器端插件
// 1) crypto.randomUUID polyfill 注入（webServer.tapIndex，解决非安全上下文
//    下前端崩溃）
// 2) Host/Origin loopback 改写（prependListener，在 browser-trust fence 检查
//    之前把非 loopback 的 Host/Origin 改写成 127.0.0.1[:端口]），使
//    settings.describe 等 privileged 方法在 0.0.0.0 / 隧道访问时也放行。
// 纯服务器端、不改 dsh 内部文件，更新免疫。

export const name = "dsh-anywhere-web";
export const inject = ["webServer"];

const POLYFILL = `<script>
if (window.crypto && typeof window.crypto.randomUUID !== "function") {
  window.crypto.randomUUID = function () {
    var b = window.crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    var h = Array.from(b, function (x) { return x.toString(16).padStart(2, "0"); }).join("");
    return h.slice(0, 8) + "-" + h.slice(8, 12) + "-" + h.slice(12, 16) + "-" + h.slice(16, 20) + "-" + h.slice(20);
  };
}
</script>`;

// 解析 host[:port]，返回 { port } 或 null（空串端口）
function splitPort(authority) {
  const m = /^(?:\[[^\]]*\]|[^:]+)(?::(\d+))?$/.exec(authority);
  return m ? (m[1] ?? "") : null;
}

// 把 authority 改写为 127.0.0.1[:原端口]；非 host[:port] 形式原样返回
function toLoopback(authority) {
  const p = splitPort(authority);
  if (p === null) return authority;
  return "127.0.0.1" + (p === "" ? "" : ":" + p);
}

const LOOPBACK_RE = /^(?:127\.|localhost|\[::1\]|0x7f)/i;

// 仅改写这些"非 loopback 访问入口"的 Host，其余（如恶意/重绑定域名）原样交给
// fence 拒绝，保留 DNS rebinding 防护。匹配 0.0.0.0、私网段、隧道域名。
const REWRITE_HOST_RE = /^(?:0\.0\.0\.0|dsh\.csbprd\.top|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})$/i;

function rewriteHeaders(req) {
  const host = req.headers.host;
  if (typeof host === "string" && host !== "" && !LOOPBACK_RE.test(host)) {
    const hostname = host.split(":")[0];
    if (!REWRITE_HOST_RE.test(hostname)) return; // 不在白名单 → 不改写，fence 正常拒绝
    const rewritten = toLoopback(host);
    if (rewritten !== host) {
      req.headers.host = rewritten;
      const origin = req.headers.origin;
      if (typeof origin === "string" && origin !== "") {
        try {
          const u = new URL(origin);
          const p = splitPort(rewritten);
          u.hostname = "127.0.0.1";
          if (p !== null && p !== "") u.port = p;
          req.headers.origin = u.origin;
        } catch { /* 保留原 origin */ }
      }
    }
  }
}

export function apply(ctx) {
  // 1) index.html polyfill 注入（更新免疫）
  ctx.effect(() =>
    ctx.webServer.tapIndex((html) => {
      if (html.includes("randomUUID")) return html; // 已注入或非 index 页
      return html.replace("<head>", "<head>" + POLYFILL);
    })
  );

  // 2) Host/Origin loopback 改写：prependListener 保证先于 webserver 自身的
  //    request/upgrade 处理器运行，fence 检查（含 privileged 方法）看到
  //    的 Host 恒为 127.0.0.1 → 判定 loopback → 全放行。
  ctx.effect(() => {
    const server = ctx.webServer.server;
    const onRequest = (req) => rewriteHeaders(req);
    const onUpgrade = (req) => rewriteHeaders(req);
    server.prependListener("request", onRequest);
    server.prependListener("upgrade", onUpgrade);
    ctx.logger.info("[dsh-anywhere-web] host rewrite + polyfill loaded");
    return () => {
      server.off("request", onRequest);
      server.off("upgrade", onUpgrade);
    };
  });
}
