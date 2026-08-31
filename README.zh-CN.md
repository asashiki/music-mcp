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

**说出想听的歌，AI 就在聊天里放出一个真正可以播放的音乐播放器。**

它包含封面、同步歌词、动态进度条和歌单连播；音源来自任意 [Meting](https://github.com/metowolf/Meting) 兼容 API。

## 工作方式

1. **`search_song`** — AI 用关键词搜歌，拿到真实的平台歌曲 ID（工具说明明确要求 AI 不许编 ID，不确定就先搜）。
2. **`play_song`** — 为单曲渲染播放器 widget。
3. **`play_playlist`** — 整个歌单进队列（上一首/下一首、点队列跳转、自动连播）。

## 播放器特性

- 浅仪式（Asashiki）樱羽设计 tokens，跟随 `prefers-color-scheme` 浅/深色
- 封面图 + 光照渐变兜底、NOW PLAYING 斜切徽章、5 根律动 EQ
- 进度条带标志性 −12° 斜切尾，点击跳转，mono 时间戳
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
curl -s -X POST localhost:3000/mcp -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"search_song","arguments":{"keyword":"夜に駆ける"}}}'
```

## 远程部署（连接 claude.ai / ChatGPT 网页端）

1. `cp .env.example .env`，设置 `PUBLIC_BASE_URL`（公网 HTTPS 域名）。
2. `docker compose up -d`。
3. 反向代理 `https://你的域名/mcp/music` → 容器 `:3000`，**另外** `/stream/*`、`/cover/*`、`/lrc/*` 也要一并转发（同一容器）。
4. claude.ai 添加自定义连接器填 `https://你的域名/mcp/music`。如果设置了 `MCP_AUTH_PASSWORD`，连接器会走 OAuth 动态客户端注册，并弹出密码授权页。

> 宿主按 URI 缓存 `ui://` 资源。改过 widget 后记得升级 `src/widget/music-widget-html.ts` 里的版本号（`player-v1.html` → `v2` ……）。

## 配置项

| 变量 | 默认值 | 含义 |
|---|---|---|
| `PUBLIC_BASE_URL` | _(生产环境必填)_ | 公网 HTTPS 域名；写进 widget CSP 和媒体 URL。 |
| `PORT` | `3000` | HTTP 端口。 |
| `MCP_HTTP_PATH` | `/mcp/music` | Streamable HTTP MCP 路由。 |
| `ALLOWED_ORIGINS` | PUBLIC_BASE_URL 的 origin | CORS 白名单，逗号分隔。 |
| `METING_API_BASE` | `https://api.qijieya.cn/meting/` | 任意 Meting 兼容端点。 |
| `DEFAULT_MUSIC_SERVER` | `netease` | AI 未指定平台时的默认值。 |
| `MCP_AUTH_PASSWORD` | _(空)_ | 可选的远程连接器密码门禁。留空则关闭授权。 |
| `MCP_AUTH_SERVICE_NAME` | `music-mcp` | OAuth 密码页显示名称。 |

## OAuth 密码授权

设置 `MCP_AUTH_PASSWORD` 后，服务会启用一个最小 OAuth Authorization Code 流程，并暴露 OAuth discovery 与动态客户端注册端点。支持自动注册的客户端不需要手动填写 Client ID；连接时在授权页输入配置的密码即可。

## 说明与礼仪

音频、封面和歌词都会经过服务自己的域名代理，从而简化 widget 的 CSP、避开平台 CDN 重定向问题，并保留进度拖动所需的 `Range` 请求。

网易云封面使用独立的封面 ID；服务端会自动从 Meting 返回的图片链接中解析，无需调用方处理。

- 曲目按需从配置的 Meting API 流式播放，本服务不落盘任何音频。
- 可用性取决于上游平台（区域限制、付费曲目等），widget 会优雅显示加载失败而不是整个崩掉。
- 长期使用建议把 `METING_API_BASE` 指向自建的 Meting 后端，不要依赖公益接口。

## 开发

```bash
npm run dev          # HTTP 服务热重载
npm run typecheck
npm run build        # 服务端 (tsup) + widget（IIFE 内联进 ui:// 资源）
```

## 许可

MIT
