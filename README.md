# dsh-anywhere-web

DeepSeek Harness (dsh) web 的**任意入口访问增强插件**（dsh bundle）。

## 解决的问题

1. **非安全上下文缺 `crypto.randomUUID`**：`http://0.0.0.0:3080`、局域网明文 HTTP 访问 dsh web 时，浏览器将页面判为非安全上下文，`crypto.randomUUID` 不存在 → 前端崩溃（`crypto.randomUUID is not a function`）。
2. **privileged API 403**：dsh 的 browser-trust fence 把 `settings.describe` / `credentials.describe` / `settings.update` 等 privileged 方法**硬编码只认 loopback**，`--trusted-host` 对它们无效。经 `0.0.0.0`、局域网 IP、Cloudflare 隧道域名访问时全部 403。

## 方案

纯**服务器端插件**，通过两个官方机制，不修改 dsh 任何内部文件（`dist` / `node_modules` / 源码），**dsh 升级后依旧生效**：

1. **`webServer.tapIndex()`** —— 每次 `index.html` 响应注入 `crypto.randomUUID` polyfill（UUID v4 手写实现）。
2. **`server.prependListener("request"/"upgrade")`** —— 在 browser-trust fence 检查**之前**，把白名单内（`0.0.0.0`、私网段 `10/8`、`172.16/12`、`192.168/16`、`dsh.csbprd.top`）的 Host/Origin 改写成 `127.0.0.1[:端口]`，fence 判定为 loopback → privileged 方法全放行。白名单外的恶意/重绑定域名**不改写**，照常被 fence 拒绝（保留 DNS rebinding 防护）。

## 安装

**一行安装（推荐）：**

```sh
curl -fsSL https://raw.githubusercontent.com/CsBpRd/dsh-anywhere-web/main/install.sh | bash
```

脚本自动：`dsh plugin add` 装进 profile 的 bundle 层栈（首次使用自动初始化 profile）→ 检测到运行中的 dsh web（LaunchAgent 或手动启动均可）则自动重启加载。可调环境变量：`DSH_PROFILE`（默认 web）、`DSH_HOME`、`DSH_LAN=1`（启用局域网直连，见下文）、`DSH_NO_RESTART=1`（跳过重启）。

**手动安装：**

```sh
# 方式一：直接引用 GitHub（首次 add 若 pnpm 要求构建授权，按提示在
# pnpm-workspace.yaml 的 allowBuilds 放行本包）
dsh plugin --profile web add github:CsBpRd/dsh-anywhere-web

# 方式二：本地 checkout
dsh plugin --profile web add /path/to/dsh-anywhere-web
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

## 局域网直连（可选，DSH_LAN=1）

默认 dsh 仍只绑 `127.0.0.1`（监听面不开放）。想让**局域网内其他设备**直接访问 `http://<本机IP>:3080`，用一行安装带 `DSH_LAN=1`：

```sh
DSH_LAN=1 curl -fsSL https://raw.githubusercontent.com/CsBpRd/dsh-anywhere-web/main/install.sh | bash
```

它会把 webserver 的 bind host 覆盖为 `0.0.0.0`（写进 profile 用户层 `cordis.patch.yml`，幂等）。此时：

- 局域网设备 `http://192.168.x.x:3080` 直达，页面正常（polyfill 注入）；
- 本插件的白名单改写已覆盖私网段 → 局域网设备上**设置页同样可用**（这是同类插件 `dsh-web-lan-access` 做不到的）；
- 关闭：从 `~/.dsh/profiles/web/cordis.patch.yml` 删掉 `webserver` override 行，重启 dsh。

> ⚠️ 安全：绑 `0.0.0.0` = 局域网内任何设备都能操作 dsh（相当于远程代码执行权限）。只建议可信网络使用；公网入口请继续走 Cloudflare Access + 隧道（本插件白名单也覆盖 `dsh.csbprd.top`）。

## 卸载

```sh
dsh plugin --profile web remove dsh-anywhere-web
```

## 结构

```
dsh-anywhere-web/
├── package.json       # dsh.bundle manifest
├── cordis.patch.yml   # 注入插件行的 patch 层
├── index.js           # apply 插件：tapIndex polyfill + host 白名单改写
├── install.sh         # 一行安装脚本（curl -fsSL | bash）
├── tunnel-proxy.mjs   # 可选：隧道透传反代（与插件本体无关）
└── README.md
```
