import { App } from "@modelcontextprotocol/ext-apps";

interface TrackData {
  songId: string;
  server: string;
  title: string;
  artist: string;
  audioUrl: string;
  coverUrl: string;
  lrcUrl: string;
}

interface PlayerData {
  mode: "song" | "playlist";
  queue: TrackData[];
  startIndex: number;
}

declare global {
  interface Window {
    openai?: { toolOutput?: unknown; [k: string]: unknown };
  }
}

function coerceTrack(t: unknown): TrackData | null {
  if (!t || typeof t !== "object") return null;
  const d = t as Record<string, unknown>;
  if (typeof d.audioUrl !== "string" || typeof d.title !== "string") return null;
  return {
    songId: String(d.songId ?? ""),
    server: String(d.server ?? ""),
    title: d.title,
    artist: typeof d.artist === "string" ? d.artist : "",
    audioUrl: d.audioUrl,
    coverUrl: typeof d.coverUrl === "string" ? d.coverUrl : "",
    lrcUrl: typeof d.lrcUrl === "string" ? d.lrcUrl : ""
  };
}

function coerce(data: unknown): PlayerData | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  if (!Array.isArray(d.queue)) return null;
  const queue = d.queue.map(coerceTrack).filter((t): t is TrackData => t !== null);
  if (queue.length === 0) return null;
  const start = typeof d.startIndex === "number" ? Math.min(Math.max(0, d.startIndex), queue.length - 1) : 0;
  return { mode: d.mode === "playlist" ? "playlist" : "song", queue, startIndex: start };
}

function fmtTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

interface LrcLine { t: number; text: string; }

function parseLrc(raw: string): LrcLine[] {
  const lines: LrcLine[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const matches = [...line.matchAll(/\[(\d{1,2}):(\d{1,2})(?:\.(\d{1,3}))?\]/g)];
    if (matches.length === 0) continue;
    const text = line.replace(/\[[^\]]*\]/g, "").trim();
    if (!text) continue;
    for (const m of matches) {
      const min = Number.parseInt(m[1] ?? "0", 10);
      const sec = Number.parseInt(m[2] ?? "0", 10);
      const fracRaw = m[3] ?? "0";
      const frac = Number.parseInt(fracRaw, 10) / 10 ** fracRaw.length;
      lines.push({ t: min * 60 + sec + frac, text });
    }
  }
  return lines.sort((a, b) => a.t - b.t);
}

const SVG_PLAY = '<svg class="i-play" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.14v13.72c0 .8.87 1.3 1.56.88l11.2-6.86a1.03 1.03 0 0 0 0-1.76L9.56 4.26A1.03 1.03 0 0 0 8 5.14z"/></svg>';
const SVG_PAUSE = '<svg class="i-pause" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="4.5" width="4" height="15" rx="1.4"/><rect x="14" y="4.5" width="4" height="15" rx="1.4"/></svg>';
const SVG_PREV = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 5.5a1 1 0 0 1 2 0v5.06l9.4-5.72A1.05 1.05 0 0 1 20 5.75v12.5c0 .82-.9 1.32-1.6.9L9 13.44v5.06a1 1 0 0 1-2 0z"/></svg>';
const SVG_NEXT = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M17 5.5a1 1 0 0 1 2 0v13a1 1 0 0 1-2 0v-5.06l-9.4 5.72a1.05 1.05 0 0 1-1.6-.91V5.75c0-.82.9-1.32 1.6-.9L17 10.56z"/></svg>';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

let rendered = false;

function render(data: PlayerData, platform: "chatgpt" | "claude") {
  rendered = true;
  const root = document.getElementById("root");
  if (!root) return;
  root.innerHTML = "";
  root.className = `platform-${platform}`;

  const player = el("div", "player");
  const audio = document.createElement("audio");
  audio.preload = "metadata";

  /* top: cover + meta + eq */
  const top = el("div", "top");
  const cover = el("div", "cover");
  const mark = el("div", "mark");
  const coverImg = document.createElement("img");
  coverImg.alt = "";
  coverImg.style.display = "none";
  coverImg.addEventListener("load", () => { coverImg.style.display = ""; });
  coverImg.addEventListener("error", () => { coverImg.style.display = "none"; });
  cover.append(mark, coverImg);

  const meta = el("div", "meta");
  const titleEl = el("b");
  const artistEl = el("small");
  const np = el("div", "np");
  const npText = el("span", "", "READY");
  np.appendChild(npText);
  meta.append(titleEl, artistEl, np);

  const eq = el("div", "eq");
  for (let i = 0; i < 5; i += 1) eq.appendChild(el("i"));
  top.append(cover, meta, eq);

  /* lyric line */
  const lyric = el("div", "lyric", "");
  let lrcLines: LrcLine[] = [];
  let lrcIdx = -1;

  /* progress */
  const pgwrap = el("div", "pgwrap");
  const pg = el("div", "pg");
  const fill = el("div", "fill");
  pg.appendChild(fill);
  const lab = el("div", "pg-lab");
  const now = el("span", "", "0:00");
  const total = el("span", "", "0:00");
  lab.append(now, total);
  pgwrap.append(pg, lab);

  pg.addEventListener("click", (e) => {
    if (!Number.isFinite(audio.duration) || audio.duration <= 0) return;
    const rect = pg.getBoundingClientRect();
    const ratio = Math.min(Math.max((e.clientX - rect.left) / rect.width, 0), 1);
    audio.currentTime = ratio * audio.duration;
  });

  /* controls */
  const ctrls = el("div", "ctrls");
  const prev = el("button");
  prev.setAttribute("aria-label", "上一首");
  prev.innerHTML = SVG_PREV;
  const big = el("button", "big");
  big.setAttribute("aria-label", "播放/暂停");
  big.innerHTML = SVG_PLAY + SVG_PAUSE;
  const next = el("button");
  next.setAttribute("aria-label", "下一首");
  next.innerHTML = SVG_NEXT;
  ctrls.append(prev, big, next);

  /* queue */
  let queueBox: HTMLElement | null = null;
  const qrows: HTMLElement[] = [];
  if (data.queue.length > 1) {
    queueBox = el("div", "queue");
    data.queue.forEach((t, i) => {
      const row = el("div", "qrow");
      row.appendChild(el("span", "no", String(i + 1).padStart(2, "0")));
      row.appendChild(el("span", "qt", t.title));
      row.appendChild(el("span", "qa", t.artist));
      row.addEventListener("click", () => load(i, true));
      queueBox?.appendChild(row);
      qrows.push(row);
    });
  }

  let idx = data.startIndex;

  function setLyric(text: string, active: boolean) {
    if (lyric.textContent === text) return;
    lyric.classList.add("swap");
    setTimeout(() => {
      lyric.textContent = text;
      lyric.classList.toggle("on", active);
      lyric.classList.remove("swap");
    }, 180);
  }

  async function loadLrc(track: TrackData) {
    lrcLines = [];
    lrcIdx = -1;
    setLyric("", false);
    if (!track.lrcUrl) return;
    try {
      const res = await fetch(track.lrcUrl, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) return;
      lrcLines = parseLrc(await res.text());
    } catch {
      /* lyrics are optional */
    }
  }

  function load(i: number, autoplay: boolean) {
    idx = (i + data.queue.length) % data.queue.length;
    const track = data.queue[idx];
    if (!track) return;
    titleEl.textContent = track.title;
    artistEl.textContent = `${track.artist}${track.server ? ` · ${track.server}` : ""}`;
    coverImg.style.display = "none";
    if (track.coverUrl) coverImg.src = track.coverUrl;
    audio.src = track.audioUrl;
    fill.style.width = "0%";
    now.textContent = "0:00";
    total.textContent = "0:00";
    qrows.forEach((row, k) => row.classList.toggle("cur", k === idx));
    qrows[idx]?.scrollIntoView({ block: "nearest" });
    void loadLrc(track);
    if (autoplay) void audio.play();
  }

  audio.addEventListener("loadedmetadata", () => {
    if (Number.isFinite(audio.duration)) total.textContent = fmtTime(audio.duration);
  });
  audio.addEventListener("timeupdate", () => {
    if (Number.isFinite(audio.duration) && audio.duration > 0) {
      fill.style.width = `${(audio.currentTime / audio.duration) * 100}%`;
      now.textContent = fmtTime(audio.currentTime);
    }
    if (lrcLines.length > 0) {
      let k = lrcLines.length - 1;
      while (k >= 0 && (lrcLines[k]?.t ?? 0) > audio.currentTime) k -= 1;
      if (k !== lrcIdx) {
        lrcIdx = k;
        setLyric(k >= 0 ? lrcLines[k]?.text ?? "" : "", k >= 0);
      }
    }
  });
  audio.addEventListener("play", () => {
    player.classList.add("playing");
    npText.textContent = "NOW PLAYING";
  });
  audio.addEventListener("pause", () => {
    player.classList.remove("playing");
    npText.textContent = "PAUSED";
  });
  audio.addEventListener("ended", () => {
    if (data.queue.length > 1) load(idx + 1, true);
    else {
      player.classList.remove("playing");
      npText.textContent = "READY";
      fill.style.width = "0%";
    }
  });
  audio.addEventListener("error", () => {
    player.classList.remove("playing");
    npText.textContent = "LOAD FAILED";
    setLyric("音频加载失败，可能该曲目在此平台不可用", false);
  });

  big.addEventListener("click", () => {
    if (audio.paused) void audio.play();
    else audio.pause();
  });
  if (data.queue.length > 1) {
    prev.addEventListener("click", () => load(idx - 1, true));
    next.addEventListener("click", () => load(idx + 1, true));
  } else {
    prev.disabled = true;
    next.disabled = true;
  }

  player.append(top, lyric, pgwrap, ctrls);
  if (queueBox) player.appendChild(queueBox);
  player.appendChild(audio);
  root.appendChild(player);

  load(idx, false);
}

function showError(msg: string) {
  if (rendered) return;
  const root = document.getElementById("root");
  if (root) root.innerHTML = `<div class="err">${msg}</div>`;
}

function tryChatGpt() {
  if (!window.openai) return;
  const apply = () => {
    const data = coerce(window.openai?.toolOutput);
    if (data) render(data, "chatgpt");
  };
  apply();
  window.addEventListener("openai:set_globals", apply as EventListener);
}

async function tryMcpApps() {
  try {
    const app = new App({ name: "music-mcp", version: "0.1.0" });
    /* Use addEventListener so the handler is registered synchronously before connect() */
    app.addEventListener("toolresult", (params: { structuredContent?: unknown }) => {
      console.debug("[music-mcp] ontoolresult params:", JSON.stringify(params)?.slice(0, 200));
      const data = coerce(params?.structuredContent);
      if (data) render(data, "claude");
    });
    await app.connect();
  } catch (e) {
    console.debug("[music-mcp] MCP Apps connect skipped:", e);
  }
}

function boot() {
  /* Run both bridges in parallel — rendered flag prevents double-render */
  tryChatGpt();
  void tryMcpApps();
  setTimeout(() => showError("等待音乐数据..."), 4000);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}
