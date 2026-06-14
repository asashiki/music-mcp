import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { AppConfig } from "./config.js";
import { MUSIC_SERVERS, getPlaylist, getSong, searchSongs, type MusicServer, type Track } from "./meting.js";
import { MUSIC_WIDGET_MIME, MUSIC_WIDGET_URI, musicWidgetHtml } from "./widget/music-widget-html.js";

export interface TrackPayload {
  songId: string;
  server: string;
  title: string;
  artist: string;
  audioUrl: string;
  coverUrl: string;
  lrcUrl: string;
}

export interface PlayerPayload {
  mode: "song" | "playlist";
  queue: TrackPayload[];
  startIndex: number;
  playlistId?: string;
}

const WIDGET_DOMAIN = "https://music-mcp.asashiki.com";
const trackPayloadSchema = {
  songId: z.string(),
  server: z.string(),
  title: z.string(),
  artist: z.string(),
  audioUrl: z.string(),
  coverUrl: z.string(),
  lrcUrl: z.string()
};
const playerPayloadSchema = {
  mode: z.enum(["song", "playlist"]),
  queue: z.array(z.object(trackPayloadSchema)),
  startIndex: z.number(),
  playlistId: z.string().optional()
};

function cspMeta(config: AppConfig) {
  const origins = [new URL(config.publicBaseUrl).origin];
  return {
    ui: { csp: { resourceDomains: origins, connectDomains: origins } },
    "openai/widgetDomain": WIDGET_DOMAIN,
    "openai/widgetCSP": { resource_domains: origins, connect_domains: origins }
  };
}

function toPayload(config: AppConfig, track: Track): TrackPayload {
  const base = config.publicBaseUrl;
  return {
    songId: track.songId,
    server: track.server,
    title: track.title,
    artist: track.artist,
    audioUrl: `${base}/stream/${track.server}/${encodeURIComponent(track.songId)}`,
    coverUrl: `${base}/cover/${track.server}/${encodeURIComponent(track.picId)}`,
    lrcUrl: `${base}/lrc/${track.server}/${encodeURIComponent(track.songId)}`
  };
}

function playerJsonBlock(payload: PlayerPayload) {
  return { type: "text" as const, text: JSON.stringify(payload) };
}

const serverSchema = z
  .enum(MUSIC_SERVERS)
  .optional()
  .describe("Music platform: netease (default) | tencent | kugou | kuwo | baidu.");

export function createMusicServer(config: AppConfig): McpServer {
  const server = new McpServer({ name: "music-mcp", version: "0.1.0" });
  const csp = cspMeta(config);
  const widgetMeta = {
    ui: { resourceUri: MUSIC_WIDGET_URI },
    "openai/outputTemplate": MUSIC_WIDGET_URI
  };

  server.registerResource(
    "music-player",
    MUSIC_WIDGET_URI,
    {
      title: "Music Player",
      description: "Playable in-chat music player with cover art, progress, queue and synced lyrics.",
      mimeType: MUSIC_WIDGET_MIME,
      _meta: csp
    },
    async () => ({
      contents: [
        { uri: MUSIC_WIDGET_URI, mimeType: MUSIC_WIDGET_MIME, text: musicWidgetHtml(), _meta: csp }
      ]
    })
  );

  server.registerTool(
    "search_song",
    {
      title: "Search Songs",
      description:
        "Search a music platform by keyword (song title, artist, or both) and get candidate tracks with their ids. " +
        "ALWAYS use this first when you don't know the exact platform song id — never invent ids. " +
        "Then call play_song with the chosen songId.",
      inputSchema: {
        keyword: z.string().min(1).max(80).describe("Search keywords, e.g. '夜に駆ける YOASOBI'."),
        musicServer: serverSchema,
        limit: z.number().int().min(1).max(20).optional().describe("Max results, default 8.")
      },
      annotations: { readOnlyHint: true, openWorldHint: true }
    },
    async ({ keyword, musicServer, limit }) => {
      const srv = (musicServer ?? config.defaultServer) as MusicServer;
      try {
        const tracks = await searchSongs(config.metingApiBase, srv, keyword, limit ?? 8);
        if (tracks.length === 0) {
          return { content: [{ type: "text", text: `No results for '${keyword}' on ${srv}.` }] };
        }
        const lines = tracks.map((t, i) => `${i + 1}. ${t.title} — ${t.artist} (songId: ${t.songId})`);
        return {
          content: [
            {
              type: "text",
              text: `Results on ${srv} for '${keyword}':\n${lines.join("\n")}\n\nCall play_song with the best songId to start playback.`
            }
          ]
        };
      } catch (e) {
        return {
          content: [{ type: "text", text: `Search failed: ${e instanceof Error ? e.message : String(e)}` }],
          isError: true
        };
      }
    }
  );

  server.registerTool(
    "play_song",
    {
      title: "Play Song",
      description:
        "Render a playable music player in the chat for one song. " +
        "Use when the user asks to play / listen to a song, or when sharing a track fits the moment (celebration, mood, recommendation). " +
        "Requires the platform songId — if you don't know it, call search_song first. " +
        "The player shows cover art, progress, and synced lyrics; the user presses play.",
      inputSchema: {
        songId: z.string().min(1).max(40).describe("Platform song id, e.g. '825522' (from search_song or the user)."),
        musicServer: serverSchema
      },
      outputSchema: playerPayloadSchema,
      annotations: { readOnlyHint: true, openWorldHint: true },
      _meta: widgetMeta
    },
    async ({ songId, musicServer }) => {
      const srv = (musicServer ?? config.defaultServer) as MusicServer;
      try {
        const track = await getSong(config.metingApiBase, srv, songId);
        const payload: PlayerPayload = { mode: "song", queue: [toPayload(config, track)], startIndex: 0 };
        return {
          content: [
            {
              type: "text",
              text: `Music player ready: ${track.title} — ${track.artist} (${srv}). The user can press play in the widget.`
            },
            playerJsonBlock(payload)
          ],
          structuredContent: payload as unknown as Record<string, unknown>,
          _meta: widgetMeta
        };
      } catch (e) {
        return {
          content: [{ type: "text", text: `Failed to load song: ${e instanceof Error ? e.message : String(e)}. Try search_song to verify the id.` }],
          isError: true
        };
      }
    }
  );

  server.registerTool(
    "play_playlist",
    {
      title: "Play Playlist",
      description:
        "Render a playable music player in the chat for a whole platform playlist (with queue, prev/next). " +
        "Use when the user shares a playlist id or asks for continuous music. " +
        "Requires the platform playlist id (the number in the playlist URL).",
      inputSchema: {
        playlistId: z.string().min(1).max(40).describe("Platform playlist id, e.g. '2619366284'."),
        musicServer: serverSchema,
        limit: z.number().int().min(1).max(50).optional().describe("Max tracks to queue, default 20."),
        startIndex: z.number().int().min(0).optional().describe("Index of the track to cue first, default 0.")
      },
      outputSchema: playerPayloadSchema,
      annotations: { readOnlyHint: true, openWorldHint: true },
      _meta: widgetMeta
    },
    async ({ playlistId, musicServer, limit, startIndex }) => {
      const srv = (musicServer ?? config.defaultServer) as MusicServer;
      try {
        const tracks = await getPlaylist(config.metingApiBase, srv, playlistId, limit ?? 20);
        if (tracks.length === 0) {
          return {
            content: [{ type: "text", text: `Playlist ${playlistId} on ${srv} is empty or not found.` }],
            isError: true
          };
        }
        const start = Math.min(startIndex ?? 0, tracks.length - 1);
        const payload: PlayerPayload = {
          mode: "playlist",
          queue: tracks.map((t) => toPayload(config, t)),
          startIndex: start,
          playlistId
        };
        const preview = tracks.slice(0, 5).map((t, i) => `${i + 1}. ${t.title} — ${t.artist}`).join("\n");
        return {
          content: [
            {
              type: "text",
              text: `Playlist player ready (${tracks.length} tracks, ${srv}):\n${preview}${tracks.length > 5 ? "\n…" : ""}`
            },
            playerJsonBlock(payload)
          ],
          structuredContent: payload as unknown as Record<string, unknown>,
          _meta: widgetMeta
        };
      } catch (e) {
        return {
          content: [{ type: "text", text: `Failed to load playlist: ${e instanceof Error ? e.message : String(e)}` }],
          isError: true
        };
      }
    }
  );

  return server;
}
