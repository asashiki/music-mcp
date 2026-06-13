<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset=".github/assets/banner-dark.svg">
  <img alt="music-mcp — in-chat music player" src=".github/assets/banner-light.svg" width="100%">
</picture>

[![CI](https://github.com/asashiki/music-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/asashiki/music-mcp/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-e96ba8.svg)](LICENSE)
![Node](https://img.shields.io/badge/node-%E2%89%A5%2020-8b8bef)
![MCP](https://img.shields.io/badge/MCP-stdio%20%2B%20Streamable%20HTTP-3a3340)

**English** · [简体中文](README.zh-CN.md)

</div>

# music-mcp

An MCP server that lets AI drop a **playable music player** straight into the chat — cover art, sakura-styled progress bar, animated EQ, synced lyrics, and playlist queue. Audio comes from any [Meting](https://github.com/metowolf/Meting)-compatible API (netease / tencent / kugou / kuwo / baidu).

## How it works

1. **`search_song`** — AI searches a platform by keyword and gets real song ids (so it never has to invent them).
2. **`play_song`** — renders the player widget for one track.
3. **`play_playlist`** — queues a whole platform playlist (prev/next, click-to-jump queue, auto-advance).

The server proxies all media through its own origin (`/stream/:server/:id`, `/cover/...`, `/lrc/...`):

- the widget iframe only needs **one CSP origin** (`PUBLIC_BASE_URL`),
- platform CDN redirect chains can't break `<audio>` under widget CSP,
- `Range` headers are forwarded, so seeking works.

## Player features

- Asashiki sakura design tokens, light/dark via `prefers-color-scheme`
- Cover art with glow fallback, NOW PLAYING skewed badge, 5-bar animated EQ
- Progress bar with signature −12° cut fill, click to seek, mono timestamps
- **Synced lyrics**: fetches and parses LRC, highlights the current line
- Playlist queue with current-track highlight and auto-advance

## Quick start

```bash
npm install
npm run build
npm start            # Streamable HTTP on :3000 (/mcp/music, /mcp alias, /healthz)
```

Smoke test:

```bash
curl -s -X POST localhost:3000/mcp -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"search_song","arguments":{"keyword":"夜に駆ける"}}}'
```

## Remote deployment (claude.ai / ChatGPT web)

1. `cp .env.example .env`, set `PUBLIC_BASE_URL` (public HTTPS origin).
2. `docker compose up -d`.
3. Reverse-proxy `https://your-domain/mcp/music` → container `:3000`, **plus** `/stream/*`, `/cover/*`, `/lrc/*` (same container).
4. Add a custom connector in claude.ai with `https://your-domain/mcp/music`. If `MCP_AUTH_PASSWORD` is set, the connector will use OAuth dynamic client registration and show the password authorization page.

> Hosts cache `ui://` resources by URI. After widget changes, bump the version in `src/widget/music-widget-html.ts` (`player-v1.html` → `v2` ...).

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `PUBLIC_BASE_URL` | _(required in production)_ | Public HTTPS origin; written into widget CSP and media URLs. |
| `PORT` | `3000` | HTTP port. |
| `MCP_HTTP_PATH` | `/mcp/music` | Streamable HTTP MCP route. |
| `ALLOWED_ORIGINS` | PUBLIC_BASE_URL origin | CORS allowlist, comma separated. |
| `METING_API_BASE` | `https://api.qijieya.cn/meting/` | Any Meting-compatible endpoint. |
| `DEFAULT_MUSIC_SERVER` | `netease` | Platform used when the AI doesn't specify one. |
| `MCP_AUTH_PASSWORD` | _(empty)_ | Optional password gate for remote connectors. Leave empty to disable auth. |

## OAuth password auth

Set `MCP_AUTH_PASSWORD` to enable a minimal OAuth Authorization Code flow for remote connectors. The server exposes OAuth discovery and dynamic client registration, so clients that support automatic registration can connect without a manually configured Client ID. During connection, enter the configured password on the authorization page.

## Notes & etiquette

- Tracks are streamed on demand from the configured Meting API; nothing is stored on disk.
- Availability depends on the upstream platform (region locks, paid tracks). The widget shows a graceful "load failed" state instead of breaking.
- Point `METING_API_BASE` at your own Meting deployment for reliability.

## Development

```bash
npm run dev          # HTTP server with reload
npm run typecheck
npm run build        # server (tsup) + widget (IIFE inlined into the ui:// resource)
```

## License

MIT
