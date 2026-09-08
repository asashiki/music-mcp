interface TrackData {
  songId: string; server: string; title: string; artist: string;
  audioUrl: string; coverUrl: string; lrcUrl: string;
}
interface PlayerData { mode: "song" | "playlist"; queue: TrackData[]; startIndex: number; }
declare global {
  interface Window { openai?: { toolOutput?: unknown; [k: string]: unknown }; }
}

function coerce(data: unknown): PlayerData | null {
  if (typeof data === "string") {
    try { return coerce(JSON.parse(data)); } catch { return null; }
  }
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  if (!Array.isArray(d.queue)) return null;
  const queue: TrackData[] = [];
  for (const value of d.queue) {
    if (!value || typeof value !== "object") continue;
    const t = value as Record<string, unknown>;
    if (typeof t.audioUrl !== "string" || typeof t.title !== "string") continue;
    queue.push({ songId: String(t.songId ?? ""), server: String(t.server ?? ""), title: t.title,
      artist: typeof t.artist === "string" ? t.artist : "", audioUrl: t.audioUrl,
      coverUrl: typeof t.coverUrl === "string" ? t.coverUrl : "",
      lrcUrl: typeof t.lrcUrl === "string" ? t.lrcUrl : "" });
  }
  if (!queue.length) return null;
  const start = typeof d.startIndex === "number" && Number.isFinite(d.startIndex) ? Math.trunc(d.startIndex) : 0;
  return { mode: d.mode === "playlist" ? "playlist" : "song", queue,
    startIndex: Math.min(Math.max(0, start), queue.length - 1) };
}
function fmtTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  return `${Math.floor(sec / 60)}:${Math.floor(sec % 60).toString().padStart(2, "0")}`;
}
interface LrcLine { t: number; text: string; }
function parseLrc(raw: string): LrcLine[] {
  const lines: LrcLine[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const text = line.replace(/\[[^\]]*\]/g, "").trim();
    if (!text) continue;
    for (const m of line.matchAll(/\[(\d{1,2}):(\d{1,2})(?:\.(\d{1,3}))?\]/g)) {
      const fraction = m[3] ?? "0";
      lines.push({ t: Number(m[1]) * 60 + Number(m[2]) + Number(fraction) / 10 ** fraction.length, text });
    }
  }
  return lines.sort((a, b) => a.t - b.t);
}
const SVG_PLAY = '<svg class="i-play" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>';
const SVG_PAUSE = '<svg class="i-pause" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>';
const SVG_PREV = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M6 5h2v14H6zM18 5v14L8 12z"/></svg>';
const SVG_NEXT = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M16 5h2v14h-2zM6 5v14l10-7z"/></svg>';
function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

let rendered = false, disposed = false, standardDataReceived = false, initialized = false;
let lastPayload = "";
let teardownCurrent: (() => void) | null = null;
let observer: ResizeObserver | null = null;
let resizeFrame = 0, lastHeight = -1;
let waitingTimer: ReturnType<typeof setTimeout> | undefined;

// The host owns width. Report content height only, after initialization, and
// never echo an unchanged size back into the host's layout/global-state cycle.
function scheduleSize() {
  if (disposed || resizeFrame) return;
  resizeFrame = requestAnimationFrame(() => {
    resizeFrame = 0;
    if (disposed) return;
    const root = document.getElementById("root");
    if (!root) return;
    const height = Math.ceil(root.getBoundingClientRect().height);
    if (height <= 0 || height === lastHeight) return;
    if (initialized) {
      lastHeight = height;
      postMessage({ method: "ui/notifications/size-changed", params: { height } });
    } else if (typeof window.openai?.notifyIntrinsicHeight === "function") {
      lastHeight = height;
      window.openai.notifyIntrinsicHeight(height);
    }
  });
}
function applyHostContext(value: unknown) {
  if (!value || typeof value !== "object") return;
  const context = value as { theme?: unknown; locale?: unknown; styles?: { variables?: Record<string, unknown> } };
  const html = document.documentElement;
  if (context.theme === "light" || context.theme === "dark") html.dataset.theme = context.theme;
  if (typeof context.locale === "string") html.lang = context.locale;
  for (const key of ["--color-text-primary", "--color-text-secondary", "--color-background-secondary",
    "--color-border-primary", "--font-sans"]) {
    const value = context.styles?.variables?.[key];
    if (typeof value === "string") html.style.setProperty(key, value);
  }
  scheduleSize();
}

function render(data: PlayerData, bridge: "mcp-app" | "chatgpt-compat") {
  if (disposed || (bridge === "chatgpt-compat" && standardDataReceived)) return;
  if (bridge === "mcp-app") standardDataReceived = true;
  document.documentElement.dataset.bridge = bridge;
  // Normalize first, so new objects, JSON text fallback and both bridges agree.
  // Never remount media in response to theme, height, focus or duplicate data.
  const signature = JSON.stringify(data);
  if (signature === lastPayload) return;
  const root = document.getElementById("root");
  if (!root) return;
  teardownCurrent?.();
  lastPayload = signature;
  rendered = true;
  clearTimeout(waitingTimer);
  root.replaceChildren();
  const player = el("div", "player");
  const audio = el("audio");
  audio.preload = "metadata";
  audio.volume = 0.55;
  const top = el("div", "top"), cover = el("div", "cover");
  const coverImg = el("img");
  coverImg.alt = ""; coverImg.hidden = true;
  coverImg.addEventListener("load", () => { coverImg.hidden = false; });
  coverImg.addEventListener("error", () => { coverImg.hidden = true; });
  cover.append(el("span", "mark"), coverImg);
  const meta = el("div", "meta"), titleEl = el("b"), artistEl = el("span", "artist");
  meta.append(titleEl, artistEl);
  const ctrls = el("div", "ctrls");
  const prev = el("button"), big = el("button", "big"), next = el("button");
  for (const button of [prev, big, next]) button.type = "button";
  prev.setAttribute("aria-label", "上一首"); prev.innerHTML = SVG_PREV;
  next.setAttribute("aria-label", "下一首"); next.innerHTML = SVG_NEXT;
  big.setAttribute("aria-label", "播放"); big.innerHTML = SVG_PLAY + SVG_PAUSE;
  if (data.queue.length > 1) ctrls.append(prev, big, next);
  else ctrls.append(big);
  const eq = el("div", "eq"); eq.setAttribute("aria-hidden", "true");
  for (let i = 0; i < 5; i++) eq.append(el("i"));
  top.append(cover, meta, eq);

  const pgwrap = el("div", "pgwrap"), pg = el("input", "pg");
  pg.type = "range"; pg.min = "0"; pg.max = "1000"; pg.value = "0"; pg.disabled = true;
  pg.setAttribute("aria-label", "播放进度");
  const lab = el("div", "pg-lab"), now = el("span", "", "0:00"), total = el("span", "", "0:00");
  lab.append(now, total); pgwrap.append(pg, lab);
  pg.addEventListener("input", () => {
    if (Number.isFinite(audio.duration) && audio.duration > 0) {
      audio.currentTime = Number(pg.value) / 1000 * audio.duration;
      now.textContent = fmtTime(audio.currentTime);
      pg.style.setProperty("--progress", `${Number(pg.value) / 10}%`);
    }
  });
  const lyric = el("div", "lyric"), status = el("div", "status");
  lyric.hidden = true; status.hidden = true; status.setAttribute("role", "status");
  let lrcLines: LrcLine[] = [], lrcIdx = -1, idx = data.startIndex, loadVersion = 0, active = true;
  let lyricsController: AbortController | null = null;
  const qrows: HTMLButtonElement[] = [];
  const queueBox = el("div", "queue");
  if (data.queue.length > 1) {
    data.queue.forEach((track, i) => {
      const row = el("button", "qrow"); row.type = "button";
      row.append(el("span", "no", String(i + 1)), el("span", "qt", track.title), el("span", "qa", track.artist));
      row.addEventListener("click", () => load(i, true));
      queueBox.append(row); qrows.push(row);
    });
  }
  function setStatus(text: string) {
    status.textContent = text; status.hidden = !text; scheduleSize();
  }
  function setLyric(text: string) {
    if (lyric.textContent === text) return;
    lyric.textContent = text; lyric.hidden = !text; scheduleSize();
  }
  function setPlaying(playing: boolean) {
    player.classList.toggle("playing", playing);
    big.setAttribute("aria-label", playing ? "暂停" : "播放");
  }
  async function loadLrc(track: TrackData, version: number) {
    lyricsController?.abort();
    lrcLines = []; lrcIdx = -1; setLyric("");
    if (!track.lrcUrl) return;
    const controller = new AbortController(); lyricsController = controller;
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const res = await fetch(track.lrcUrl, { signal: controller.signal });
      if (!res.ok) return;
      const raw = await res.text();
      if (active && version === loadVersion) lrcLines = parseLrc(raw);
    } catch { /* Optional lyrics must not block playback. */ }
    finally { clearTimeout(timeout); }
  }
  async function startPlayback() {
    const version = loadVersion;
    setStatus("");
    try { await audio.play(); }
    catch (error) {
      if (!active || version !== loadVersion) return;
      const name = (error as { name?: string })?.name;
      if (name === "AbortError") return; // A newer user action replaced this play.
      setPlaying(false);
      setStatus(name === "NotAllowedError" ? "请点击播放，允许浏览器播放音频。"
        : "音频无法播放：媒体地址不可用或返回了不支持的内容。");
    }
  }
  function load(i: number, autoplay: boolean) {
    loadVersion++;
    idx = (i + data.queue.length) % data.queue.length;
    const track = data.queue[idx]!;
    audio.pause(); setPlaying(false); setStatus("");
    titleEl.textContent = track.title; artistEl.textContent = track.artist;
    coverImg.hidden = true;
    if (track.coverUrl) coverImg.src = track.coverUrl;
    else coverImg.removeAttribute("src");
    audio.src = track.audioUrl;
    pg.value = "0"; pg.style.setProperty("--progress", "0%"); pg.disabled = true; now.textContent = "0:00"; total.textContent = "0:00";
    // Keep the queue compact without an inner scrollbar or a scrollIntoView
    // call that can unexpectedly move the surrounding conversation.
    const start = Math.max(0, Math.min(idx - 2, data.queue.length - 5));
    qrows.forEach((row, k) => {
      row.classList.toggle("cur", k === idx); row.setAttribute("aria-current", String(k === idx));
      row.hidden = k < start || k >= start + 5;
    });
    void loadLrc(track, loadVersion); scheduleSize();
    if (autoplay) void startPlayback();
  }
  audio.addEventListener("loadedmetadata", () => {
    const valid = Number.isFinite(audio.duration) && audio.duration > 0;
    pg.disabled = !valid; total.textContent = fmtTime(audio.duration);
  });
  audio.addEventListener("timeupdate", () => {
    if (Number.isFinite(audio.duration) && audio.duration > 0) {
      pg.value = String(audio.currentTime / audio.duration * 1000);
      now.textContent = fmtTime(audio.currentTime);
      pg.style.setProperty("--progress", `${Number(pg.value) / 10}%`);
      pg.setAttribute("aria-valuetext", `${fmtTime(audio.currentTime)} / ${fmtTime(audio.duration)}`);
    }
    let k = lrcLines.length - 1;
    while (k >= 0 && lrcLines[k]!.t > audio.currentTime) k--;
    if (k !== lrcIdx) { lrcIdx = k; setLyric(k >= 0 ? lrcLines[k]!.text : ""); }
  });
  audio.addEventListener("play", () => setPlaying(true));
  audio.addEventListener("playing", () => setStatus(""));
  audio.addEventListener("pause", () => setPlaying(false));
  audio.addEventListener("ended", () => {
    if (data.queue.length > 1) load(idx + 1, true);
    else setPlaying(false);
  });
  audio.addEventListener("error", () => {
    if (!active) return;
    setPlaying(false); setStatus("音频加载失败：请检查媒体地址能否公开访问。");
  });
  big.addEventListener("click", () => {
    if (audio.paused) { if (audio.error) audio.load(); void startPlayback(); }
    else audio.pause();
  });
  prev.addEventListener("click", () => load(idx - 1, true));
  next.addEventListener("click", () => load(idx + 1, true));
  player.append(top, pgwrap, ctrls, lyric, status);
  if (qrows.length) player.append(queueBox);
  player.append(audio); root.append(player);
  teardownCurrent = () => {
    active = false; lyricsController?.abort();
    audio.pause(); audio.removeAttribute("src"); audio.load();
  };
  load(idx, false);
}

function showError(msg: string) {
  if (rendered || disposed) return;
  const root = document.getElementById("root");
  if (root) root.replaceChildren(el("div", "status", msg));
  scheduleSize();
}
function renderToolResult(value: unknown) {
  if (!value || typeof value !== "object") return;
  const params = value as { structuredContent?: unknown; content?: Array<{ type: string; text?: string }> };
  let data = coerce(params.structuredContent);
  for (const block of params.content ?? []) {
    if (data) break;
    if (block.type === "text") data = coerce(block.text);
  }
  if (data) render(data, "mcp-app");
}
function applyCompatibility(event?: Event) {
  if (disposed) return;
  const globals = (event as CustomEvent<{ globals?: Record<string, unknown> }> | undefined)?.detail?.globals;
  applyHostContext(globals ?? window.openai);
  if (standardDataReceived || (globals && !Object.hasOwn(globals, "toolOutput"))) return;
  const data = coerce(globals?.toolOutput ?? window.openai?.toolOutput);
  if (data) render(data, "chatgpt-compat");
}

type RpcMessage = { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: unknown; result?: unknown; error?: unknown };
let nextRequestId = 1;
const pendingRequests = new Map<number, { resolve: (v: unknown) => void; reject: (v: unknown) => void; timer: ReturnType<typeof setTimeout> }>();
function postMessage(message: Record<string, unknown>) {
  if (window.parent !== window) window.parent.postMessage({ jsonrpc: "2.0", ...message }, "*");
}
function request(method: string, params: Record<string, unknown>): Promise<unknown> {
  const id = nextRequestId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingRequests.delete(id); reject(new Error(`${method} timed out`));
    }, 5000);
    pendingRequests.set(id, { resolve, reject, timer });
    postMessage({ id, method, params });
  });
}
function dispose() {
  if (disposed) return;
  disposed = true; teardownCurrent?.(); observer?.disconnect();
  clearTimeout(waitingTimer); cancelAnimationFrame(resizeFrame);
  window.removeEventListener("openai:set_globals", applyCompatibility);
  window.removeEventListener("message", onMessage);
  for (const pending of pendingRequests.values()) {
    clearTimeout(pending.timer); pending.reject(new Error("Widget closed"));
  }
  pendingRequests.clear();
}
function onMessage(event: MessageEvent) {
  if (disposed || event.source !== window.parent) return;
  const message = event.data as RpcMessage;
  if (!message || message.jsonrpc !== "2.0") return;
  if (typeof message.id === "number" && ("result" in message || "error" in message)) {
    const pending = pendingRequests.get(message.id);
    if (!pending) return;
    pendingRequests.delete(message.id); clearTimeout(pending.timer);
    if (message.error) pending.reject(message.error); else pending.resolve(message.result);
    return;
  }
  if (message.method === "ui/notifications/tool-result") renderToolResult(message.params);
  if (message.method === "ui/notifications/host-context-changed") applyHostContext(message.params);
  if (message.method === "ui/resource-teardown") {
    dispose();
    if (typeof message.id === "string" || typeof message.id === "number") postMessage({ id: message.id, result: {} });
  }
}
function boot() {
  window.addEventListener("message", onMessage);
  window.addEventListener("openai:set_globals", applyCompatibility);
  window.addEventListener("pagehide", dispose, { once: true });
  const root = document.getElementById("root");
  if (root && typeof ResizeObserver !== "undefined") {
    observer = new ResizeObserver(scheduleSize); observer.observe(root);
  }
  applyCompatibility();
  void request("ui/initialize", { appInfo: { name: "music-mcp", version: "0.2.1" },
    appCapabilities: {}, protocolVersion: "2026-01-26" }).then((result) => {
    if (disposed) return;
    initialized = true; lastHeight = -1;
    applyHostContext((result as { hostContext?: unknown } | null)?.hostContext);
    postMessage({ method: "ui/notifications/initialized", params: {} });
    scheduleSize();
  }).catch(() => { /* Old hosts can deliver results through window.openai. */ });
  waitingTimer = setTimeout(() => showError("暂未收到歌曲，请重新调用播放器。"), 5000);
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
else boot();
export {};
