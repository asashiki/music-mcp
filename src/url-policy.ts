import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const MAX_REDIRECTS = 5;
const DNS_CACHE_TTL_MS = 60_000;
const publicHostCache = new Map<string, { expiresAt: number; public: boolean }>();

function privateIpv4(address: string): boolean {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b, c] = parts as [number, number, number, number];
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && (c === 0 || c === 2)) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 88 && c === 99) ||
    (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
    (a === 203 && b === 0 && c === 113)
  );
}

function privateIp(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return privateIpv4(address);
  if (family !== 6) return true;
  const normalized = address.toLowerCase();
  if (normalized.startsWith("::ffff:")) return privateIpv4(normalized.slice(7));
  return (
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    /^fe[89ab]/.test(normalized) ||
    normalized.startsWith("ff")
  );
}

async function isPublicHostname(hostname: string): Promise<boolean> {
  const normalized = hostname.toLowerCase().replace(/\.$/, "");
  if (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized.endsWith(".local") ||
    normalized === "metadata.google.internal" ||
    normalized === "metadata.azure.internal"
  ) return false;

  if (isIP(normalized)) return !privateIp(normalized);
  const cached = publicHostCache.get(normalized);
  if (cached && cached.expiresAt > Date.now()) return cached.public;
  const addresses = await lookup(normalized, { all: true, verbatim: true });
  const result = addresses.length > 0 && addresses.every(({ address }) => !privateIp(address));
  publicHostCache.set(normalized, { expiresAt: Date.now() + DNS_CACHE_TTL_MS, public: result });
  return result;
}

async function assertSafeUrl(url: URL, allowPrivate: boolean): Promise<void> {
  if (!(["http:", "https:"] as string[]).includes(url.protocol)) {
    throw new Error(`Blocked non-HTTP media URL: ${url.protocol}`);
  }
  if (url.username || url.password) throw new Error("Blocked media URL containing credentials");
  if (!allowPrivate && !(await isPublicHostname(url.hostname))) {
    throw new Error(`Blocked private or special-use media host: ${url.hostname}`);
  }
}

/**
 * Fetch a configured Meting endpoint while re-validating every redirect.
 * The initial endpoint is operator-controlled and may live on a private Docker
 * network; redirects are public-only unless explicitly opted in.
 */
export async function fetchWithRedirectPolicy(
  input: string | URL,
  init: RequestInit = {},
  options: { allowPrivateInitialUrl?: boolean; allowPrivateRedirects?: boolean; maxRedirects?: number } = {}
): Promise<Response> {
  let current = new URL(input);
  const maxRedirects = options.maxRedirects ?? MAX_REDIRECTS;
  for (let redirectCount = 0; ; redirectCount += 1) {
    await assertSafeUrl(current, redirectCount === 0
      ? Boolean(options.allowPrivateInitialUrl)
      : Boolean(options.allowPrivateRedirects));
    const response = await fetch(current, { ...init, redirect: "manual" });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get("location");
    await response.body?.cancel().catch(() => undefined);
    if (!location) throw new Error(`Upstream redirect ${response.status} did not include Location`);
    if (redirectCount >= maxRedirects) throw new Error(`Upstream exceeded ${maxRedirects} redirects`);
    current = new URL(location, current);
  }
}

/** Read a small JSON/text response without allowing an upstream to fill RAM. */
export async function readTextLimited(response: Response, maxBytes: number): Promise<string> {
  const declaredLength = Number.parseInt(response.headers.get("content-length") ?? "", 10);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error(`Upstream response exceeds ${maxBytes} bytes`);
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new Error(`Upstream response exceeds ${maxBytes} bytes`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(combined);
}
