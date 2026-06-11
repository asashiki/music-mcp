/**
 * Minimal client for Meting-compatible APIs
 * (https://github.com/metowolf/Meting — `?server=&type=&id=`).
 */

export const MUSIC_SERVERS = ["netease", "tencent", "kugou", "kuwo", "baidu"] as const;
export type MusicServer = (typeof MUSIC_SERVERS)[number];

export interface MetingRawItem {
  name?: string;
  artist?: string;
  url?: string;
  pic?: string;
  lrc?: string;
}

export interface Track {
  songId: string;
  server: MusicServer;
  title: string;
  artist: string;
  /** Cover image id — platforms like netease use a separate id for type=pic. */
  picId: string;
}

function extractParam(url: string | undefined, key: string): string | null {
  if (!url) return null;
  try {
    return new URL(url).searchParams.get(key);
  } catch {
    return null;
  }
}

export function metingUrl(base: string, server: string, type: string, id: string): string {
  const u = new URL(base);
  u.searchParams.set("server", server);
  u.searchParams.set("type", type);
  u.searchParams.set("id", id);
  return u.toString();
}

async function fetchMeting(base: string, server: string, type: string, id: string): Promise<MetingRawItem[]> {
  const res = await fetch(metingUrl(base, server, type, id), {
    signal: AbortSignal.timeout(15_000),
    headers: { "User-Agent": "music-mcp/0.1" }
  });
  if (!res.ok) throw new Error(`Meting API HTTP ${res.status} (${type} ${id})`);
  const json = (await res.json()) as unknown;
  if (Array.isArray(json)) return json as MetingRawItem[];
  if (json && typeof json === "object") return [json as MetingRawItem];
  throw new Error("Unexpected Meting API response shape.");
}

function toTrack(item: MetingRawItem, server: MusicServer): Track | null {
  const songId = extractParam(item.url, "id") ?? extractParam(item.lrc, "id");
  if (!songId) return null;
  return {
    songId,
    server,
    title: item.name?.trim() || "未知曲目",
    artist: item.artist?.trim() || "未知歌手",
    picId: extractParam(item.pic, "id") ?? songId
  };
}

export async function searchSongs(base: string, server: MusicServer, keyword: string, limit: number): Promise<Track[]> {
  const items = await fetchMeting(base, server, "search", keyword);
  return items
    .map((item) => toTrack(item, server))
    .filter((t): t is Track => t !== null)
    .slice(0, limit);
}

export async function getSong(base: string, server: MusicServer, id: string): Promise<Track> {
  const items = await fetchMeting(base, server, "song", id);
  const track = items.length > 0 && items[0] ? toTrack(items[0], server) : null;
  if (!track) throw new Error(`Song ${id} not found on ${server}.`);
  // Some deployments omit the id in sub-urls for type=song; trust the requested id.
  return { ...track, songId: track.songId || id };
}

export async function getPlaylist(base: string, server: MusicServer, id: string, limit: number): Promise<Track[]> {
  const items = await fetchMeting(base, server, "playlist", id);
  return items
    .map((item) => toTrack(item, server))
    .filter((t): t is Track => t !== null)
    .slice(0, limit);
}
