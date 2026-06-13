import cors from "cors";
import express from "express";
import type { Request, Response } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { Readable } from "node:stream";
import { loadConfig } from "./config.js";
import { setupOAuth } from "./oauth.js";
import { createMusicServer } from "./mcp.js";
import { MUSIC_SERVERS, metingUrl } from "./meting.js";

const config = loadConfig({ requirePublicBaseUrl: process.env.NODE_ENV === "production" });
const mcpPaths = Array.from(new Set([config.mcpHttpPath, "/mcp"]));

function validServer(value: string): boolean {
  return (MUSIC_SERVERS as readonly string[]).includes(value);
}

/**
 * Proxy a Meting media URL (which 302s to a platform CDN) through our origin,
 * so the widget iframe only ever talks to PUBLIC_BASE_URL (single CSP origin)
 * and redirect chains can't break playback. Forwards Range for seeking.
 */
async function proxyMedia(req: Request, res: Response, type: "url" | "pic", contentTypeFallback: string) {
  const srv = String(req.params.server);
  const id = String(req.params.id);
  if (!validServer(srv) || !/^[\w-]{1,64}$/.test(id)) {
    res.status(400).send("Bad request");
    return;
  }
  try {
    const headers: Record<string, string> = { "User-Agent": "music-mcp/0.1" };
    const range = req.headers.range;
    if (typeof range === "string") headers.Range = range;

    const upstream = await fetch(metingUrl(config.metingApiBase, srv, type, id), {
      headers,
      redirect: "follow",
      signal: AbortSignal.timeout(30_000)
    });
    if (!upstream.ok && upstream.status !== 206) {
      res.status(upstream.status === 404 ? 404 : 502).send(`Upstream ${upstream.status}`);
      return;
    }

    res.status(upstream.status);
    const passthrough = ["content-type", "content-length", "content-range", "accept-ranges"];
    for (const h of passthrough) {
      const v = upstream.headers.get(h);
      if (v) res.setHeader(h, v);
    }
    if (!upstream.headers.get("content-type")) res.setHeader("Content-Type", contentTypeFallback);
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cache-Control", "public, max-age=3600");

    if (!upstream.body) {
      res.end();
      return;
    }
    Readable.fromWeb(upstream.body as import("node:stream/web").ReadableStream).pipe(res);
  } catch (e) {
    if (!res.headersSent) res.status(502).send(`Proxy error: ${e instanceof Error ? e.message : "unknown"}`);
  }
}

async function main() {
  const app = express();
  app.set("trust proxy", true);
  app.use(
    cors({
      origin(origin, callback) {
        if (!origin || config.allowedOrigins.length === 0 || config.allowedOrigins.includes(origin)) {
          callback(null, true);
          return;
        }
        callback(null, false);
      }
    })
  );
  app.use(express.json({ limit: "1mb" }));

  const bearerAuth = setupOAuth(app, config.publicBaseUrl, "music-mcp");

  app.get("/stream/:server/:id", (req, res) => void proxyMedia(req, res, "url", "audio/mpeg"));
  app.get("/cover/:server/:id", (req, res) => void proxyMedia(req, res, "pic", "image/jpeg"));

  app.get("/lrc/:server/:id", async (req, res) => {
    const srv = String(req.params.server);
    const id = String(req.params.id);
    if (!validServer(srv) || !/^[\w-]{1,64}$/.test(id)) {
      res.status(400).send("Bad request");
      return;
    }
    try {
      const upstream = await fetch(metingUrl(config.metingApiBase, srv, "lrc", id), {
        redirect: "follow",
        signal: AbortSignal.timeout(15_000),
        headers: { "User-Agent": "music-mcp/0.1" }
      });
      const text = upstream.ok ? await upstream.text() : "";
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Cache-Control", "public, max-age=86400");
      res.send(text);
    } catch {
      res.status(502).send("");
    }
  });

  app.get("/healthz", (_req, res) => {
    res.json({
      ok: true,
      service: "music-mcp",
      transport: "streamable-http",
      publicBaseUrl: config.publicBaseUrl,
      mcpEndpoint: `${config.publicBaseUrl}${config.mcpHttpPath}`,
      metingApiBase: config.metingApiBase,
      defaultServer: config.defaultServer
    });
  });

  app.all(mcpPaths, bearerAuth, async (req, res) => {
    const origin = req.headers.origin;
    if (origin && config.allowedOrigins.length > 0 && !config.allowedOrigins.includes(origin)) {
      res.status(403).json({ error: "Origin not allowed" });
      return;
    }

    const server = createMusicServer(config);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: error instanceof Error ? error.message : "Internal server error" },
          id: null
        });
      }
    } finally {
      void transport.close();
      void server.close();
    }
  });

  const httpServer = app.listen(config.port, "0.0.0.0", () => {
    console.log(`music-mcp listening on :${config.port} (${config.mcpHttpPath})`);
  });
  httpServer.keepAliveTimeout = 70_000;
  httpServer.headersTimeout = 75_000;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
