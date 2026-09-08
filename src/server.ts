import cors from "cors";
import express from "express";
import type { Request, Response } from "express";
import {
  LATEST_PROTOCOL_VERSION,
  SUPPORTED_PROTOCOL_VERSIONS,
  createMcpHandler,
  validateHostHeader
} from "@modelcontextprotocol/server";
import { toNodeHandler } from "@modelcontextprotocol/node";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { loadConfig, type AppConfig } from "./config.js";
import { setupOAuth } from "./oauth.js";
import { createMusicServer, musicWidgetResourceMeta } from "./mcp.js";
import { MUSIC_SERVERS, metingUrl } from "./meting.js";
import { MUSIC_WIDGET_MIME, MUSIC_WIDGET_URI, musicWidgetHtml } from "./widget/music-widget-html.js";
import { fetchWithRedirectPolicy, readTextLimited } from "./url-policy.js";

function validServer(value: string): boolean {
  return (MUSIC_SERVERS as readonly string[]).includes(value);
}

/**
 * Proxy a Meting media URL through our origin so the widget needs one CSP
 * origin. Range response headers are preserved for audio seeking.
 */
async function proxyMedia(
  config: AppConfig,
  req: Request,
  res: Response,
  type: "url" | "pic",
  contentTypeFallback: string
) {
  const server = String(req.params.server);
  const id = String(req.params.id);
  if (!validServer(server) || !/^[\w-]{1,64}$/.test(id)) {
    res.status(400).send("Bad request");
    return;
  }
  try {
    const headers: Record<string, string> = {
      "User-Agent": "music-mcp/0.2",
      "Accept-Encoding": "identity"
    };
    const range = req.headers.range;
    if (typeof range === "string") headers.Range = range;

    const upstream = await fetchWithRedirectPolicy(metingUrl(config.metingApiBase, server, type, id), {
      headers,
      signal: AbortSignal.timeout(30_000)
    }, {
      allowPrivateInitialUrl: true,
      allowPrivateRedirects: config.allowPrivateMetingRedirects
    });
    if (!upstream.ok && upstream.status !== 206) {
      res.status(upstream.status === 404 ? 404 : 502).send(`Upstream ${upstream.status}`);
      return;
    }

    res.status(upstream.status);
    for (const header of [
      "content-type",
      "content-length",
      "content-range",
      "accept-ranges",
      "etag",
      "last-modified"
    ]) {
      const value = upstream.headers.get(header);
      if (value) res.setHeader(header, value);
    }
    if (!upstream.headers.get("content-type")) res.setHeader("Content-Type", contentTypeFallback);
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.setHeader("Vary", "Range");

    if (req.method === "HEAD" || !upstream.body) {
      await upstream.body?.cancel().catch(() => undefined);
      res.end();
      return;
    }
    const stream = Readable.fromWeb(upstream.body as import("node:stream/web").ReadableStream);
    stream.on("error", () => {
      if (!res.headersSent) res.status(502);
      res.end();
    });
    stream.pipe(res);
  } catch (error) {
    if (!res.headersSent) res.status(502).send(`Proxy error: ${error instanceof Error ? error.message : "unknown"}`);
  }
}

export function createMusicHttpApp(config: AppConfig) {
  const app = express();
  const mcpPaths = Array.from(new Set([config.mcpHttpPath, "/mcp"]));
  const canonicalMcpResource = `${config.publicBaseUrl}${config.mcpHttpPath}`;
  const widgetMeta = musicWidgetResourceMeta(config);

  app.disable("x-powered-by");
  // The Compose deployment exposes the app only through one local reverse
  // proxy hop. Trusting arbitrary proxy chains lets clients spoof req.ip and
  // defeats the authorization-page rate limiter.
  app.set("trust proxy", 1);
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

  const bearerAuth = setupOAuth(app, {
    baseUrl: config.publicBaseUrl,
    resourceUrl: canonicalMcpResource,
    password: config.authPassword,
    tokenSecret: config.authTokenSecret,
    serviceName: process.env.MCP_AUTH_SERVICE_NAME?.trim() || "music-mcp",
    scope: config.oauthScope,
    allowLegacyResourceOmission: config.allowLegacyResourceOmission
  });

  app.get("/stream/:server/:id", (req, res) => void proxyMedia(config, req, res, "url", "audio/mpeg"));
  app.get("/cover/:server/:id", (req, res) => void proxyMedia(config, req, res, "pic", "image/jpeg"));

  app.get("/lrc/:server/:id", async (req, res) => {
    const server = String(req.params.server);
    const id = String(req.params.id);
    if (!validServer(server) || !/^[\w-]{1,64}$/.test(id)) {
      res.status(400).send("Bad request");
      return;
    }
    try {
      const upstream = await fetchWithRedirectPolicy(metingUrl(config.metingApiBase, server, "lrc", id), {
        signal: AbortSignal.timeout(15_000),
        headers: { "User-Agent": "music-mcp/0.2" }
      }, {
        allowPrivateInitialUrl: true,
        allowPrivateRedirects: config.allowPrivateMetingRedirects
      });
      const text = upstream.ok ? await readTextLimited(upstream, 512 * 1024) : "";
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
      res.setHeader("X-Content-Type-Options", "nosniff");
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
      version: "0.2.2",
      transport: "streamable-http",
      latestProtocolVersion: LATEST_PROTOCOL_VERSION,
      supportedProtocolVersions: SUPPORTED_PROTOCOL_VERSIONS,
      publicBaseUrl: config.publicBaseUrl,
      mcpEndpoint: canonicalMcpResource,
      defaultServer: config.defaultServer,
      oauthEnabled: Boolean(config.authPassword)
    });
  });

  app.get("/diagnostics/mcp-app", (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json({
      widget: {
        uri: MUSIC_WIDGET_URI,
        mimeType: MUSIC_WIDGET_MIME,
        htmlBytes: Buffer.byteLength(musicWidgetHtml(), "utf8"),
        dedicatedDomain: config.widgetDomain ?? null,
        sandbox: config.widgetDomain ? "dedicated-domain" : "host-default"
      },
      resourceMeta: widgetMeta,
      mediaOrigin: new URL(config.publicBaseUrl).origin,
      mediaRoutes: ["/stream/:server/:id", "/cover/:server/:id", "/lrc/:server/:id"],
      compatibility: {
        standard: "MCP Apps 2026-01-26 ui/* bridge",
        chatgpt: "window.openai is progressive fallback only"
      }
    });
  });

  const mcpHandler = createMcpHandler(() => createMusicServer(config), {
    legacy: "stateless",
    responseMode: "auto"
  });
  const nodeMcpHandler = toNodeHandler(mcpHandler);

  app.all(mcpPaths, bearerAuth, async (req, res) => {
    const host = validateHostHeader(req.headers.host, config.allowedHosts);
    if (!host.ok) {
      res.status(403).json({ jsonrpc: "2.0", error: { code: -32000, message: host.message }, id: null });
      return;
    }
    const origin = typeof req.headers.origin === "string" ? req.headers.origin : undefined;
    if (origin && config.allowedOrigins.length > 0 && !config.allowedOrigins.includes(origin)) {
      res.status(403).json({ jsonrpc: "2.0", error: { code: -32000, message: "Origin not allowed" }, id: null });
      return;
    }
    await nodeMcpHandler(req, res, req.body);
  });

  return {
    app,
    close: () => mcpHandler.close()
  };
}

export async function main() {
  const config = loadConfig({ requirePublicBaseUrl: process.env.NODE_ENV === "production" });
  const runtime = createMusicHttpApp(config);
  const httpServer = runtime.app.listen(config.port, "0.0.0.0", () => {
    console.log(`music-mcp listening on :${config.port} (${config.mcpHttpPath})`);
  });
  httpServer.keepAliveTimeout = 70_000;
  httpServer.headersTimeout = 75_000;
  httpServer.on("close", () => void runtime.close());
}

const entrypoint = process.argv[1] ? resolve(process.argv[1]) : "";
if (entrypoint && fileURLToPath(import.meta.url) === entrypoint) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
