# dsh-neiwangchuantou

DeepSeek Harness (dsh) web 的**内网穿透辅助插件**（dsh bundle）。

## 解决的问题

1. **非安全上下文缺 `crypto.randomUUID`**：`http://0.0.0.0:3080`、局域网明文 HTTP 访问 dsh web 时，浏览器将页面判为非安全上下文，`crypto.randomUUID` 不存在 → 前端崩溃（`crypto.randomUUID is not a function`）。
2. **privileged API 403**：dsh 的 browser-trust fence 把 `settings.describe` / `credentials.describe` / `settings.update` 等 privileged 方法**硬编码只认 loopback**，`--trusted-host` 对它们无效。经 `0.0.0.0`、局域网 IP、Cloudflare 隧道域名访问时全部 403。

## 方案

纯**服务器端插件**，通过两个官方机制，不修改 dsh 任何内部文件（`dist` / `node_modules` / 源码），**dsh 升级后依旧生效**：

1. **`webServer.tapIndex()`** —— 每次 `index.html` 响应注入 `crypto.randomUUID` polyfill（UUID v4 手写实现）。
2. **`server.prependListener("request"/"upgrade")`** —— 在 browser-trust fence 检查**之前**，把白名单内（`0.0.0.0`、私网段 `10/8`、`172.16/12`、`192.168/16`、`dsh.csbprd.top`）的 Host/Origin 改写成 `127.0.0.1[:端口]`，fence 判定为 loopback → privileged 方法全放行。白名单外的恶意/重绑定域名**不改写**，照常被 fence 拒绝（保留 DNS rebinding 防护）。

## 安装

```sh
# 方式一：直接引用 GitHub（首次 add 若 pnpm 要求构建授权，按提示在
# pnpm-workspace.yaml 的 allowBuilds 放行本包）
dsh plugin --profile web add github:CsBpRd/dsh-neiwangchuantou

# 方式二：本地 checkout
dsh plugin --profile web add /path/to/dsh-neiwangchuantou
```

装好后重启 dsh web：

```sh
launchctl kickstart -k gui/$(id -u)/com.cbr.dsh-web   # LaunchAgent 管理时
```

验证：

```sh
curl -sS http://127.0.0.1:3080/ | grep randomUUID                     # polyfill 注入
curl -sS -o /dev/null -w "%{http_code}\n" \
  -H "Host: 0.0.0.0:3080" http://127.0.0.1:3080/api/settings.describe  # 应 404 而非 403
```

## 配套：隧道透传反代（可选）

`tunnel-proxy.mjs` 是配合 Cloudflare Tunnel 使用的**纯透传**反代（`127.0.0.1:3090` → dsh `127.0.0.1:3080`）。Host 改写已由插件在 dsh 内部完成，此反代不改任何头，只做 HTTP + WebSocket 透传。用 LaunchAgent 常驻：

```sh
node tunnel-proxy.mjs   # 环境变量 LISTEN_PORT / BIND_HOST / UPSTREAM_PORT
```

## 卸载

```sh
dsh plugin --profile web remove dsh-neiwangchuantou
```

## 结构

```
dsh-neiwangchuantou/
├── package.json       # dsh.bundle manifest
├── cordis.patch.yml   # 注入插件行的 patch 层
├── index.js           # apply 插件：tapIndex polyfill + host 白名单改写
├── tunnel-proxy.mjs   # 可选：隧道透传反代（与插件本体无关）
└── README.md
```
