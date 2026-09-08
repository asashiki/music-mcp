# 组件能显示，但音乐播不了

MCP 工具成功只证明歌曲元数据已返回。浏览器还必须能够访问 `PUBLIC_BASE_URL` 下的 `/stream/`、`/cover/` 和 `/lrc/`。Switch 能通过 Docker 内网调用 Music，不代表这个公网入口已经可用；Switch 不会代理这些媒体 URL。

2026-09-08 的实际工具返回使用 `https://music-canary.asashiki.com`。本次工作环境请求该地址的音频路径收到代理返回的 502 / Connection refused。这不是 VPS 日志，不能单凭它确定根因，也不能据此认定 Meting 配置错误。

## 给 VPS 上的 AI

请先检查浏览器实际收到的三个媒体 URL，而不是只检查容器健康和 MCP 响应。把 `play_song` 的真实 `structuredContent` 存成 `tool-result.json`，运行：

```sh
node scripts/check-media.mjs tool-result.json
```

脚本也包含在新 Docker 镜像的 `/app/scripts/`。它只读取响应开头，不下载整首歌。分别从 VPS 和能访问公网的另一台机器运行，检查 HTTP 状态、Content-Type 和响应内容；HTTP 200 的 HTML/JSON 错误页也不能当成音频。

- 公网失败、容器内相同路径成功：检查域名、TLS、反向代理上游端口及 `/stream/`、`/cover/`、`/lrc/` 路由。不能只转发 `/mcp/music`。
- 容器内也失败：检查对应 Meting `url/pic/lrc` 请求及重定向，记录响应状态和类型。搜歌成功不代表这三个资源成功。
- HTTP 检查通过、ChatGPT 仍失败：看浏览器 Network/Console 的媒体请求、CSP 和音频解码错误；不要再把问题归因于 MCP 连接。

完成部署后，确认 `/healthz` 为 0.2.2、资源 URI 为 `player-v9.html`，让 Switch 重新发现上游并在 ChatGPT 新对话测试。验收要求是点击后时间递增且实际听到声音，封面和歌词分别检查；不是“播放器已生成”。

## 本次代码边界

恢复原有樱粉/淡紫、大封面、居中播放控制和渐变进度条，保留重复通知不重建音频、宿主高度适配、键盘进度控制。没有恢复入场淡入和嵌套外框。

新增公网媒体检查脚本及回归测试，工具结果明确说明播放尚未验证。此提交不声称已修复线上媒体故障；缺少 VPS 的真实媒体响应和浏览器错误证据。当前环境不能进行 ChatGPT 浏览器播放或本地页面截图验收。
