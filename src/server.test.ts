import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import type { AppConfig } from "./config.js";
import { createMusicHttpApp } from "./server.js";
import { MUSIC_WIDGET_MIME, MUSIC_WIDGET_URI } from "./widget/music-widget-html.js";

async function listen(server: http.Server): Promise<string> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return `http://127.0.0.1:${address.port}`;
}

function config(metingApiBase = "https://api.example/meting/"): AppConfig {
  return {
    port: 0,
    publicBaseUrl: "https://music.example",
    mcpHttpPath: "/mcp/music",
    allowedOrigins: [],
    allowedHosts: ["127.0.0.1"],
    metingApiBase,
    defaultServer: "netease",
    authPassword: "",
    authTokenSecret: "",
    oauthScope: "tools:read",
    allowLegacyResourceOmission: false,
    allowPrivateMetingRedirects: false
  };
}

test("one endpoint serves MCP 2026 and legacy clients with portable MCP Apps metadata", async () => {
  const runtime = createMusicHttpApp(config());
  const server = http.createServer(runtime.app);
  const baseUrl = await listen(server);
  const modern = new Client(
    { name: "music-modern-test", version: "0.0.0" },
    { versionNegotiation: { mode: "auto" } }
  );
  try {
    await modern.connect(new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp/music`)));
    assert.equal(modern.getNegotiatedProtocolVersion(), "2026-07-28");

    const listed = await modern.listTools();
    assert.deepEqual(listed.tools.map((tool) => tool.name).sort(), ["play_playlist", "play_song", "search_song"]);
    const playSong = listed.tools.find((tool) => tool.name === "play_song");
    assert.ok(playSong);
    const toolMeta = playSong._meta as Record<string, unknown>;
    assert.deepEqual(toolMeta.ui, { resourceUri: MUSIC_WIDGET_URI });
    assert.equal(toolMeta["openai/outputTemplate"], MUSIC_WIDGET_URI);
    assert.equal(toolMeta["openai/widgetDomain"], undefined);
    assert.ok(playSong.outputSchema, "structured player output should be advertised");

    const resources = await modern.listResources();
    const widget = resources.resources.find((resource) => resource.uri === MUSIC_WIDGET_URI);
    assert.ok(widget);
    assert.equal(widget.mimeType, MUSIC_WIDGET_MIME);
    const resourceMeta = widget._meta as Record<string, unknown>;
    assert.equal((resourceMeta.ui as { domain?: string }).domain, undefined);
    assert.equal(resourceMeta["openai/widgetDomain"], undefined);

    const read = await modern.readResource({ uri: MUSIC_WIDGET_URI });
    assert.equal(read.contents.length, 1);
    const content = read.contents[0] as { mimeType?: string; text?: string };
    assert.equal(content.mimeType, MUSIC_WIDGET_MIME);
    assert.match(content.text ?? "", /ui\/initialize/);
    assert.match(content.text ?? "", /ui\/notifications\/initialized/);
    assert.doesNotMatch(content.text ?? "", /播放器未构建/);
    assert.ok(Buffer.byteLength(content.text ?? "", "utf8") < 50_000, "widget should remain a lean inline bundle");

    const diagnostics = await fetch(`${baseUrl}/diagnostics/mcp-app`);
    assert.equal(diagnostics.status, 200);
    const diagnosticBody = await diagnostics.json() as { widget: { uri: string; mimeType: string; sandbox: string } };
    assert.equal(diagnosticBody.widget.uri, MUSIC_WIDGET_URI);
    assert.equal(diagnosticBody.widget.mimeType, MUSIC_WIDGET_MIME);
    assert.equal(diagnosticBody.widget.sandbox, "host-default");

    const legacy = new Client({ name: "music-legacy-test", version: "0.0.0" });
    try {
      await legacy.connect(new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`)));
      assert.notEqual(legacy.getNegotiatedProtocolVersion(), "2026-07-28");
      assert.ok((await legacy.listTools()).tools.some((tool) => tool.name === "play_song"));
    } finally {
      await legacy.close();
    }
  } finally {
    await modern.close();
    await runtime.close();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("HTTP boundary rejects an unexpected Host and preserves audio Range responses", async () => {
  const meting = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://meting.test");
    assert.equal(url.searchParams.get("type"), "url");
    assert.equal(req.headers.range, "bytes=0-3");
    res.statusCode = 206;
    res.setHeader("content-type", "audio/mpeg");
    res.setHeader("content-range", "bytes 0-3/10");
    res.setHeader("accept-ranges", "bytes");
    res.end(Buffer.from([1, 2, 3, 4]));
  });
  const metingBase = await listen(meting);
  const runtime = createMusicHttpApp(config(`${metingBase}/meting`));
  const server = http.createServer(runtime.app);
  const baseUrl = await listen(server);
  try {
    const media = await fetch(`${baseUrl}/stream/netease/825522`, { headers: { range: "bytes=0-3" } });
    assert.equal(media.status, 206);
    assert.equal(media.headers.get("content-range"), "bytes 0-3/10");
    assert.equal(media.headers.get("accept-ranges"), "bytes");
    assert.equal(media.headers.get("cross-origin-resource-policy"), "cross-origin");
    assert.deepEqual([...new Uint8Array(await media.arrayBuffer())], [1, 2, 3, 4]);

    const rejectedStatus = await new Promise<number>((resolve, reject) => {
      const request = http.request(`${baseUrl}/mcp/music`, {
        method: "POST",
        headers: { Host: "evil.example", "Content-Type": "application/json" }
      }, (response) => {
        response.resume();
        response.on("end", () => resolve(response.statusCode ?? 0));
      });
      request.on("error", reject);
      request.end(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }));
    });
    assert.equal(rejectedStatus, 403);
  } finally {
    await runtime.close();
    await Promise.all([
      new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
      new Promise<void>((resolve, reject) => meting.close((error) => error ? reject(error) : resolve()))
    ]);
  }
});
