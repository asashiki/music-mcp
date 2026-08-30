# ChatGPT 播放器恢复与 0.2 升级手册

## 这次故障不是单一 CSS 问题

2026-08-30 的只读线上检查中，`https://music-mcp.asashiki.com/healthz` 返回 `502 Bad Gateway`（connection refused）。旧代码又把同一个 origin 固定写进 `openai/widgetDomain`。ChatGPT 会使用这项 OpenAI 元数据创建组件环境；服务端不可达时，组件资源、音频和歌词都会一起失败。Claude 对这项私有别名的处理不同，所以会出现“Claude 看起来还能工作、ChatGPT 组件加载不出来”的差异。

0.2 同时处理两层问题：

- 部署层：新增健康、诊断端点、Host/Origin 校验和蓝绿升级步骤，先确认公网 origin 真能到达容器。
- 组件层：使用开放 MCP Apps `ui/initialize`、tool result notification、size change 与 teardown；`window.openai` 只保留为渐进兼容。默认不再声明一个并不存在的专用 widget domain。

CSS 仍完全封装在组件 iframe 内。主题跟随 `prefers-color-scheme`，不依赖 ChatGPT 或 Claude 的 DOM/CSS；宿主差异通过标准 host context 消化，而不是判断客户端名字。

## 不停旧服务的蓝绿升级

现有 VPS 旧版可以继续运行，不要原地覆盖。

1. 从 `agent/chatgpt-mcp-apps-compat` 分支构建新镜像，例如 `music-mcp:0.2-canary`。
2. 新容器绑定 `127.0.0.1:3100`，旧容器继续占用 `3000`。
3. 给 canary 准备独立 HTTPS origin，例如 `music-canary.example.com`，并把 `PUBLIC_BASE_URL`、`ALLOWED_HOSTS`、`ALLOWED_ORIGINS` 全部设为 canary 值。
4. 反向代理下列路径到 `3100`：
   - `/mcp/music` 与 `/mcp`
   - `/stream/*`、`/cover/*`、`/lrc/*`
   - `/healthz`、`/diagnostics/mcp-app`
   - `/.well-known/*`、`/oauth/*`
5. 先访问：

   ```bash
   curl -fsS https://music-canary.example.com/healthz
   curl -fsS https://music-canary.example.com/diagnostics/mcp-app
   ```

6. 在 ChatGPT 建一个仅用于测试的 connector，依次验证：发现三个工具、搜歌、打开单曲、点播放、拖动进度、歌词、歌单下一首、断开后重连。
7. 再用 Claude 或 MCP Inspector 验证同一 endpoint，确认不是只对一个宿主做了特判。
8. 验证完成后才把正式域名的反向代理切到 `3100`。旧容器至少保留一个观察周期，回滚只需把代理切回去。

升级会把 widget URI 提升到 `ui://music-mcp/player-v7.html`，用于绕开宿主对旧组件资源的缓存。

## 生产配置要点

- `MCP_AUTH_TOKEN_SECRET` 使用单独的高熵随机值，升级时保持不变。
- `MCP_WIDGET_DOMAIN` 通常留空。只有专用 widget origin 已经部署并能长期稳定访问时才填写。
- `MCP_OAUTH_ALLOW_LEGACY_RESOURCE_OMISSION=true` 是迁移兼容开关；确认所有客户端都发送 RFC 8707 `resource` 后再收紧为 `false`。
- 默认阻止 Meting 重定向到 localhost、私网、link-local 和云 metadata 地址；仅在明确需要内部媒体后端时开启 `METING_ALLOW_PRIVATE_REDIRECTS`。
- Compose 默认 rootless、只读根文件系统、drop capabilities、no-new-privileges，并限制 PID/内存/CPU。

## 502 排查顺序

1. VPS 上 `curl http://127.0.0.1:容器端口/healthz` 是否成功。
2. 容器 healthcheck 是否 healthy，日志里是否因 `PUBLIC_BASE_URL` 或 Host 配置退出。
3. 反向代理 upstream 端口是否仍指向已停止的旧容器。
4. 公网 `/healthz` 是否返回 200，TLS 证书和 SNI 是否正确。
5. `/diagnostics/mcp-app` 中 URI、MIME、media origin 是否符合预期。
6. `/stream/平台/歌曲ID` 带 `Range` 请求时是否返回 206。
7. ChatGPT 中删除旧测试 connector 后重建，排除 connector 和 `ui://` 缓存。

## 0.2 的自动验证

`npm test` 会覆盖：

- MCP 2026-07-28 自动协商与 2025 客户端兼容；
- tools/resources、标准 UI 元数据及 OpenAI 别名；
- 组件 MIME、实际 bundle 注入和体积上限；
- S256 PKCE、redirect/client/resource 绑定、授权码一次性使用；
- 密码不进入 URL 或错误页面；
- Host 拒绝、音频 Range/CORS/CORP；
- Meting 响应缺少歌曲 ID 时的回退；
- 媒体重定向 SSRF 防护。
