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

Version 0.2 serves both MCP 2026-07-28 and legacy 2025 clients. The player is standards-first (`ui/*` MCP Apps bridge); `window.openai` is a progressive fallback instead of a separate ChatGPT-only implementation.

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
- Cover art with sakura/lavender fallback and animated EQ during playback
- Gradient progress with click, drag and keyboard seeking
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
curl -s localhost:3000/healthz
curl -s localhost:3000/diagnostics/mcp-app
npm test
```

## Remote deployment (claude.ai / ChatGPT web)

1. `cp .env.example .env`, set `PUBLIC_BASE_URL` (public HTTPS origin).
2. `docker compose up -d`.
3. Reverse-proxy `https://your-domain/mcp/music` → container `:3000`, **plus** `/stream/*`, `/cover/*`, `/lrc/*` (same container).
4. Add a custom connector in ChatGPT or Claude with `https://your-domain/mcp/music`. If `MCP_AUTH_PASSWORD` is set, the connector will use OAuth dynamic client registration and show the password authorization page.

For an existing deployment, use a second port/domain as a canary and switch the reverse proxy only after testing. Do not overwrite the working container in place.

> Hosts cache `ui://` resources by URI. After widget changes, bump the version in `src/widget/music-widget-html.ts` (`player-v1.html` → `v2` ...).

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `PUBLIC_BASE_URL` | _(required in production)_ | Public HTTPS origin; written into widget CSP and media URLs. |
| `PORT` | `3000` | HTTP port. |
| `MCP_HTTP_PATH` | `/mcp/music` | Streamable HTTP MCP route. |
| `ALLOWED_ORIGINS` | PUBLIC_BASE_URL origin | CORS allowlist, comma separated. |
| `ALLOWED_HOSTS` | public hostname + loopback | Host header allowlist; hostnames, not URLs. |
| `METING_API_BASE` | `https://api.qijieya.cn/meting/` | Any Meting-compatible endpoint. |
| `METING_ALLOW_PRIVATE_REDIRECTS` | `false` | Allow redirects to private networks; normally keep disabled. |
| `DEFAULT_MUSIC_SERVER` | `netease` | Platform used when the AI doesn't specify one. |
| `MCP_WIDGET_DOMAIN` | _(empty)_ | Optional dedicated widget HTTPS origin; leave empty unless actually deployed. |
| `MCP_AUTH_PASSWORD` | _(empty)_ | Optional password gate for remote connectors. Leave empty to disable auth. |
| `MCP_AUTH_TOKEN_SECRET` | auth password | Stable access-token signing secret; set separately in production. |
| `MCP_AUTH_SERVICE_NAME` | `music-mcp` | Optional display name on the OAuth password page. |
| `MCP_OAUTH_SCOPE` | `tools:read` | OAuth scope. |
| `MCP_OAUTH_ALLOW_LEGACY_RESOURCE_OMISSION` | `true` | Compatibility for older clients that omit RFC 8707 `resource`. |

## OAuth password auth

Set `MCP_AUTH_PASSWORD` to enable OAuth 2.1 Authorization Code + S256 PKCE for remote connectors. Codes and tokens are bound to the client, exact redirect URI, scope, PKCE challenge, and RFC 8707 resource audience. The server exposes OAuth discovery, Protected Resource Metadata, and dynamic registration.

Dynamic registrations and unredeemed codes are in memory (single-instance self-hosting); signed access tokens survive restarts when `MCP_AUTH_TOKEN_SECRET` stays stable.

## Notes & etiquette

- Tracks are streamed on demand from the configured Meting API; nothing is stored on disk.
- Availability depends on the upstream platform (region locks, paid tracks). The widget shows a graceful "load failed" state instead of breaking.
- Point `METING_API_BASE` at your own Meting deployment for reliability.

## Development

```bash
npm run dev          # HTTP server with reload
npm run typecheck
npm test             # build + OAuth/MCP/App/media-proxy integration tests
npm run build        # server + ~8 KB widget inlined into the ui:// resource
```

## License

MIT

[Media troubleshooting](docs/PUBLIC-MEDIA.zh-CN.md)
