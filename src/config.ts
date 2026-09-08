export interface AppConfig {
  port: number;
  publicBaseUrl: string;
  mcpHttpPath: string;
  allowedOrigins: string[];
  allowedHosts: string[];
  metingApiBase: string;
  defaultServer: string;
  widgetDomain?: string;
  authPassword: string;
  authTokenSecret: string;
  oauthScope: string;
  allowLegacyResourceOmission: boolean;
  allowPrivateMetingRedirects: boolean;
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

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === "") return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`Expected true or false, received: ${value}`);
}

function optionalOrigin(value: string | undefined, name: string): string | undefined {
  const raw = value?.trim();
  if (!raw) return undefined;
  const url = new URL(raw);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error(`${name} must be a dedicated HTTPS origin without a path.`);
  }
  return url.origin;
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

  const publicUrl = new URL(publicBaseUrl);
  if (publicUrl.username || publicUrl.password || publicUrl.search || publicUrl.hash) {
    throw new Error("PUBLIC_BASE_URL must not contain credentials, a query, or a fragment.");
  }
  if (publicUrl.pathname !== "/") {
    throw new Error("PUBLIC_BASE_URL must be an origin without a path; configure MCP_HTTP_PATH separately.");
  }
  if (
    options.requirePublicBaseUrl &&
    publicUrl.protocol !== "https:" &&
    !["localhost", "127.0.0.1", "[::1]"].includes(publicUrl.hostname)
  ) {
    throw new Error("PUBLIC_BASE_URL must use HTTPS outside localhost in production.");
  }

  const authPassword = process.env.MCP_AUTH_PASSWORD ?? "";
  const defaultServer = process.env.DEFAULT_MUSIC_SERVER?.trim() || "netease";
  if (!["netease", "tencent", "kugou", "kuwo", "baidu"].includes(defaultServer)) {
    throw new Error(`Unsupported DEFAULT_MUSIC_SERVER: ${defaultServer}`);
  }

  return {
    port: normalizedPort,
    publicBaseUrl,
    mcpHttpPath: normalizePath(process.env.MCP_HTTP_PATH, "/mcp/music"),
    allowedOrigins: parseList(process.env.ALLOWED_ORIGINS, [new URL(publicBaseUrl).origin]),
    allowedHosts: parseList(process.env.ALLOWED_HOSTS, [publicUrl.hostname, "localhost", "127.0.0.1", "[::1]"]),
    metingApiBase: (process.env.METING_API_BASE?.trim() || "https://api.qijieya.cn/meting/").replace(/\/?$/, "/"),
    defaultServer,
    widgetDomain: optionalOrigin(process.env.MCP_WIDGET_DOMAIN, "MCP_WIDGET_DOMAIN"),
    authPassword,
    authTokenSecret: process.env.MCP_AUTH_TOKEN_SECRET?.trim() || authPassword,
    oauthScope: process.env.MCP_OAUTH_SCOPE?.trim() || "tools:read",
    allowLegacyResourceOmission: parseBoolean(process.env.MCP_OAUTH_ALLOW_LEGACY_RESOURCE_OMISSION, true),
    allowPrivateMetingRedirects: parseBoolean(process.env.METING_ALLOW_PRIVATE_REDIRECTS, false)
  };
}
