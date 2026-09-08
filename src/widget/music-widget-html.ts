import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Bump the version suffix whenever the widget changes — hosts cache ui:// resources by URI. */
export const MUSIC_WIDGET_URI = "ui://music-mcp/player-v8.html";
export const MUSIC_WIDGET_MIME = "text/html;profile=mcp-app";

// One host-owned card; intrinsic height, responsive width and host theme tokens.
const CSS = `
  :root { color-scheme:light dark; --text:var(--color-text-primary,light-dark(#202123,#f5f5f5));
    --muted:var(--color-text-secondary,light-dark(#686868,#b5b5b5));
    --soft:var(--color-background-secondary,light-dark(#f4f4f4,#303030));
    --border:var(--color-border-primary,light-dark(#e5e5e5,#424242));
    --accent:light-dark(#b84678,#f0a2c4); }
  :root[data-theme="light"] { color-scheme:light; }
  :root[data-theme="dark"] { color-scheme:dark; }
  * { box-sizing:border-box; }
  [hidden] { display:none !important; }
  html,body { margin:0; padding:0; background:transparent; }
  body { color:var(--text); font-family:var(--font-sans,system-ui,-apple-system,"Segoe UI",sans-serif);
    -webkit-font-smoothing:antialiased; }
  #root { width:100%; }
  .player { width:100%; padding:16px; }
  .top { display:flex; align-items:center; gap:12px; }
  .cover { width:52px; height:52px; flex:none; border-radius:10px; background:var(--soft);
    display:grid; place-items:center; overflow:hidden; position:relative; }
  .mark { font-size:28px; color:var(--muted); }
  .cover img { position:absolute; inset:0; width:100%; height:100%; object-fit:cover; }
  .meta { flex:1; min-width:0; }
  .meta b,.artist { display:block; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .meta b { font-size:16px; line-height:1.5; font-weight:600; }
  .artist { font-size:14px; line-height:1.5; color:var(--muted); }
  button { font:inherit; cursor:pointer; color:inherit; }
  .ctrls { display:flex; align-items:center; gap:4px; }
  .ctrls button { width:40px; height:40px; display:grid; place-items:center;
    background:transparent; border:0; border-radius:50%; padding:8px; }
  .ctrls button:hover { background:var(--soft); }
  .ctrls button.big { width:44px; height:44px; background:var(--accent); color:light-dark(white,#25131d); }
  button:focus-visible,input:focus-visible { outline:2px solid var(--accent); outline-offset:3px; }
  .ctrls svg { width:22px; height:22px; }
  .big .i-pause,.playing .big .i-play { display:none; }
  .playing .big .i-pause { display:block; }
  .pgwrap { margin-top:12px; }
  .pg { display:block; width:100%; height:20px; margin:0; accent-color:var(--accent); cursor:pointer; }
  .pg:disabled { cursor:default; }
  .pg-lab { display:flex; justify-content:space-between; color:var(--muted); font-size:12px;
    line-height:18px; font-variant-numeric:tabular-nums; }
  .lyric { margin-top:10px; font-size:14px; color:var(--muted); line-height:1.5; overflow-wrap:anywhere; }
  .status { margin-top:10px; font-size:14px; line-height:1.5; color:var(--text); overflow-wrap:anywhere; }
  .queue { margin-top:12px; padding-top:8px; border-top:1px solid var(--border); }
  .qrow { display:flex; align-items:center; gap:10px; width:100%; border:0; background:transparent;
    border-radius:8px; padding:10px 8px; text-align:left; font-size:14px; }
  .qrow:hover,.qrow.cur { background:var(--soft); }
  .qrow .no { width:24px; flex:none; color:var(--muted); font-variant-numeric:tabular-nums; }
  .qrow .qt { flex:1; min-width:0; overflow:hidden; white-space:nowrap; text-overflow:ellipsis; }
  .qrow .qa { max-width:30%; overflow:hidden; white-space:nowrap; text-overflow:ellipsis; color:var(--muted); }
  @media (max-width:380px) { .player { padding:12px; } .cover { width:44px; height:44px; }
    .top { gap:8px; } .ctrls { gap:0; } .ctrls button { width:32px; height:36px; padding:5px; }
    .ctrls button.big { width:40px; height:40px; } }
`;

let cachedJs: string | null = null;

function widgetJs(): string {
  if (cachedJs !== null) return cachedJs;
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const jsPath = [
      resolve(here, "widget/music-widget.global.js"),
      resolve(process.cwd(), "dist/widget/music-widget.global.js")
    ].find(existsSync);
    if (!jsPath) throw new Error("Widget bundle is missing");
    cachedJs = readFileSync(jsPath, "utf8");
  } catch {
    cachedJs = `document.getElementById("root").innerHTML='<div class="err">播放器未构建（npm run build）</div>';`;
  }
  return cachedJs;
}

export function musicWidgetHtml(): string {
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<style>${CSS}</style></head>
<body><div id="root"></div><script>${widgetJs()}</script></body></html>`;
}
