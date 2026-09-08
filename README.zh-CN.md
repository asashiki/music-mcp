<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset=".github/assets/banner-dark.svg">
  <img alt="music-mcp — 对话里的音乐播放器" src=".github/assets/banner-light.svg" width="100%">
</picture>

[![CI](https://github.com/asashiki/music-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/asashiki/music-mcp/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-e96ba8.svg)](LICENSE)
![Node](https://img.shields.io/badge/node-%E2%89%A5%2020-8b8bef)
![MCP](https://img.shields.io/badge/MCP-stdio%20%2B%20Streamable%20HTTP-3a3340)

[English](README.md) · **简体中文**

</div>

# music-mcp

让 AI 直接在聊天里放出一个**可播放的音乐播放器**——封面、樱羽风进度条、律动 EQ、歌词同步高亮、歌单队列连播。音源走任意 [Meting](https://github.com/metowolf/Meting) 兼容 API（netease / tencent / kugou / kuwo / baidu）。

0.2 版同时服务 MCP 2026-07-28 与旧版 2025 客户端；播放器以开放的 MCP Apps `ui/*` bridge 为主，`window.openai` 仅作为渐进增强，不再按 ChatGPT/Claude 名称分叉实现。

## 工作方式

1. **`search_song`** — AI 用关键词搜歌，拿到真实的平台歌曲 ID（工具说明明确要求 AI 不许编 ID，不确定就先搜）。
2. **`play_song`** — 为单曲渲染播放器 widget。
3. **`play_playlist`** — 整个歌单进队列（上一首/下一首、点队列跳转、自动连播）。

所有媒体都经由服务自己的域名代理（`/stream/:server/:id`、`/cover/...`、`/lrc/...`）：

- widget iframe 的 CSP 白名单只需要**一个 origin**（`PUBLIC_BASE_URL`）；
- 各平台 CDN 的 302 重定向链不会被 widget CSP 拦截；
- `Range` 请求头透传，进度条可以随意拖动。

> 实现细节：网易云的封面要用独立的封面 ID（不是歌曲 ID），服务端会自动从 Meting 返回的 pic 链接里解析（直接拿歌曲 ID 请求封面会失败）。

## 播放器特性

- 浅仪式（Asashiki）樱羽设计 tokens，跟随 `prefers-color-scheme` 浅/深色
- 封面图、樱粉/淡紫渐变兜底、播放时的律动 EQ
- 渐变进度条，支持点击、拖动和键盘调整
- **歌词同步**：拉取并解析 LRC，当前句高亮淡入切换
- 歌单队列：当前曲目高亮、点击跳播、播完自动下一首、加载失败优雅降级

## 快速开始

```bash
npm install
npm run build
npm start            # Streamable HTTP，:3000（/mcp/music，/mcp 别名，/healthz）
```

本机冒烟测试：

```bash
curl -s localhost:3000/healthz
curl -s localhost:3000/diagnostics/mcp-app
npm test
```

## 远程部署（连接 claude.ai / ChatGPT 网页端）

1. `cp .env.example .env`，设置 `PUBLIC_BASE_URL`（公网 HTTPS 域名）。
2. `docker compose up -d`。
3. 反向代理 `https://你的域名/mcp/music` → 容器 `:3000`，**另外** `/stream/*`、`/cover/*`、`/lrc/*` 也要一并转发（同一容器）。
4. 在 ChatGPT 或 Claude 添加自定义连接器，地址填 `https://你的域名/mcp/music`。如果设置了 `MCP_AUTH_PASSWORD`，连接器会走 OAuth 动态客户端注册，并弹出密码授权页。

已经在用旧版时不要直接覆盖。先用新域名或新端口做蓝绿测试，再切反向代理；完整步骤见 [ChatGPT 播放器恢复与升级手册](docs/CHATGPT-PLAYER-RECOVERY.zh-CN.md)。

> 宿主按 URI 缓存 `ui://` 资源。改过 widget 后记得升级 `src/widget/music-widget-html.ts` 里的版本号（`player-v1.html` → `v2` ……）。

## 配置项

| 变量 | 默认值 | 含义 |
|---|---|---|
| `PUBLIC_BASE_URL` | _(生产环境必填)_ | 公网 HTTPS 域名；写进 widget CSP 和媒体 URL。 |
| `PORT` | `3000` | HTTP 端口。 |
| `MCP_HTTP_PATH` | `/mcp/music` | Streamable HTTP MCP 路由。 |
| `ALLOWED_ORIGINS` | PUBLIC_BASE_URL 的 origin | CORS 白名单，逗号分隔。 |
| `ALLOWED_HOSTS` | PUBLIC_BASE_URL 的主机名 + 本机地址 | Host header 白名单，填写主机名而不是 URL。 |
| `METING_API_BASE` | `https://api.qijieya.cn/meting/` | 任意 Meting 兼容端点。 |
| `METING_ALLOW_PRIVATE_REDIRECTS` | `false` | 是否允许 Meting 把媒体请求重定向到私网；通常不要开启。 |
| `DEFAULT_MUSIC_SERVER` | `netease` | AI 未指定平台时的默认值。 |
| `MCP_WIDGET_DOMAIN` | _(空)_ | 可选的专用 widget HTTPS origin；未真正部署专用域时不要填写。 |
| `MCP_AUTH_PASSWORD` | _(空)_ | 可选的远程连接器密码门禁。留空则关闭授权。 |
| `MCP_AUTH_TOKEN_SECRET` | MCP_AUTH_PASSWORD | access token 签名密钥；生产环境建议单独生成并保持稳定。 |
| `MCP_AUTH_SERVICE_NAME` | `music-mcp` | OAuth 密码页显示名称。 |
| `MCP_OAUTH_SCOPE` | `tools:read` | OAuth scope。 |
| `MCP_OAUTH_ALLOW_LEGACY_RESOURCE_OMISSION` | `true` | 兼容不发送 RFC 8707 `resource` 的旧客户端；确认兼容性后可改为 `false`。 |

## OAuth 密码授权

设置 `MCP_AUTH_PASSWORD` 后，服务会启用 OAuth 2.1 Authorization Code + S256 PKCE，并暴露 OAuth discovery、Protected Resource Metadata 与动态客户端注册端点。授权码绑定 client、redirect URI、PKCE challenge、scope 和 RFC 8707 resource，access token 也绑定具体 MCP audience。支持自动注册的客户端不需要手动填写 Client ID；连接时在授权页输入配置的密码即可。

动态注册和未兑换授权码当前保存在内存中，适合单实例自托管；access token 使用稳定密钥签名，正常重启后仍有效。多副本部署前应把 OAuth 临时状态迁移到共享存储。

## 说明与礼仪

- 曲目按需从配置的 Meting API 流式播放，本服务不落盘任何音频。
- 可用性取决于上游平台（区域限制、付费曲目等），widget 会优雅显示加载失败而不是整个崩掉。
- 长期使用建议把 `METING_API_BASE` 指向自建的 Meting 后端，不要依赖公益接口。

## 开发

```bash
npm run dev          # HTTP 服务热重载
npm run typecheck
npm test             # 构建 + OAuth/MCP/App/媒体代理端到端测试
npm run build        # 服务端 (tsup) + 8 KB 级 widget（IIFE 内联进 ui:// 资源）
```

## 许可

MIT

[组件显示但无法播放：媒体排查](docs/PUBLIC-MEDIA.zh-CN.md)
