export interface AppConfig {
  port: number;
  publicBaseUrl: string;
  mcpHttpPath: string;
  allowedOrigins: string[];
  metingApiBase: string;
  defaultServer: string;
}

function parseList(value: string | undefined, fallback: string[]): string[] {
  const items = (value ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return items.length > 0 ? items : fallback;
}

function normalizePath(value: string | undefined, defaultValue: string): string {
  const p = value?.trim() || defaultValue;
  return p.startsWith("/") ? p : `/${p}`;
}

export function loadConfig(options: { requirePublicBaseUrl?: boolean } = {}): AppConfig {
  const port = Number.parseInt(process.env.PORT ?? "3000", 10);
  const normalizedPort = Number.isFinite(port) ? port : 3000;
  let publicBaseUrl = process.env.PUBLIC_BASE_URL?.trim().replace(/\/$/, "") || "";
  if (!publicBaseUrl) {
    if (options.requirePublicBaseUrl) {
      throw new Error("PUBLIC_BASE_URL is required so the widget can stream audio over a public HTTPS URL.");
    }
    publicBaseUrl = `http://127.0.0.1:${normalizedPort}`;
  }

  return {
    port: normalizedPort,
    publicBaseUrl,
    mcpHttpPath: normalizePath(process.env.MCP_HTTP_PATH, "/mcp/music"),
    allowedOrigins: parseList(process.env.ALLOWED_ORIGINS, [new URL(publicBaseUrl).origin]),
    metingApiBase: (process.env.METING_API_BASE?.trim() || "https://api.qijieya.cn/meting/").replace(/\/?$/, "/"),
    defaultServer: process.env.DEFAULT_MUSIC_SERVER?.trim() || "netease"
  };
}
