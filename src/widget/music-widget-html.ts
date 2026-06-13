import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Bump the version suffix whenever the widget changes — hosts cache ui:// resources by URI. */
export const MUSIC_WIDGET_URI = "ui://music-mcp/player-v3.html";
export const MUSIC_WIDGET_MIME = "text/html;profile=mcp-app";

/* Asashiki Design · 樱羽 Sakura tokens (inlined), light + dark via prefers-color-scheme. */
const CSS = `
  :root {
    --bg-tint:#fff2f9; --bg-tint-2:#e9e9fe; --surface:#ffffff;
    --border:#f3dce9; --border-strong:#e9c4d9;
    --text:#3a3340; --text-2:#8a7d8f; --text-3:#b8aabb;
    --accent:#e96ba8; --accent-soft:#fdd9ec;
    --accent-2:#8b8bef; --accent-2-soft:#e1e1fe; --on-accent:#ffffff;
    --glow-1:#f6d8e8; --glow-2:#fdf3f8;
    --glow:linear-gradient(115deg, var(--glow-2) 0%, var(--glow-1) 35%, var(--glow-2) 65%, var(--glow-1) 100%);
    --shadow:0 1px 2px rgba(180,120,160,.06),0 4px 16px rgba(180,120,160,.08);
    --radius-s:7px; --radius-m:10px; --radius-l:14px; --skew:-12deg;
    --font:system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue","PingFang SC","Hiragino Sans","Microsoft YaHei UI","Noto Sans SC",sans-serif;
    --mono:ui-monospace,"SF Mono","Cascadia Code","JetBrains Mono",Consolas,monospace;
    color-scheme: light dark;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg-tint:#372240; --bg-tint-2:#282b58; --surface:#201b2a;
      --border:#3e3149; --border-strong:#564662;
      --text:#f1eaf4; --text-2:#b3a2ba; --text-3:#7d6e86;
      --accent:#f48fc4; --accent-soft:#4f2745;
      --accent-2:#a9a9fa; --accent-2-soft:#30305f; --on-accent:#2a1320;
      --glow-1:#43283e; --glow-2:#2c1f30;
      --shadow:0 1px 2px rgba(0,0,0,.3),0 6px 20px rgba(0,0,0,.35);
    }
  }
  * { margin:0; padding:0; box-sizing:border-box; }
  body { background:transparent; font-family:var(--font); color:var(--text);
         -webkit-font-smoothing:antialiased; }
  #root { padding:4px 0; }

  .player { background:var(--surface); border:1px solid var(--border);
            border-radius:var(--radius-l); box-shadow:var(--shadow);
            padding:16px; max-width:420px; animation:plIn .3s ease; }
  @keyframes plIn { from { transform:translateY(5px); opacity:0; } to { transform:none; opacity:1; } }

  .top { display:flex; gap:14px; align-items:center; }
  .cover { width:76px; height:76px; border-radius:var(--radius-l); flex-shrink:0;
           background:var(--glow); position:relative; overflow:hidden;
           display:flex; align-items:center; justify-content:center; }
  .cover img { position:absolute; inset:0; width:100%; height:100%; object-fit:cover; }
  .cover .mark { width:26px; height:26px; border-radius:8px;
                 background:linear-gradient(135deg, var(--accent), var(--accent-2));
                 transform:skewX(var(--skew)); }
  .player.playing .cover img { animation:coverGlowPulse 3.2s ease-in-out infinite; }
  @keyframes coverGlowPulse { 0%,100% { filter:saturate(1); } 50% { filter:saturate(1.18); } }

  .meta { min-width:0; flex:1; }
  .meta b { display:block; font-size:15px; font-weight:700;
            white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .meta small { font-size:12px; color:var(--text-2);
                display:block; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .np { display:inline-flex; margin-top:7px; font-size:10.5px; font-weight:700; letter-spacing:.12em;
        background:var(--accent-soft); color:var(--accent);
        padding:2px 9px; border-radius:var(--radius-s); transform:skewX(var(--skew)); }
  .np span { display:inline-block; transform:skewX(calc(var(--skew) * -1)); }

  .eq { display:flex; align-items:flex-end; gap:3px; height:26px; margin-left:auto; flex-shrink:0; }
  .eq i { width:4px; border-radius:2px; background:var(--accent); height:30%; transition:height .3s ease; }
  .player.playing .eq i { animation:eqbop .9s ease-in-out infinite; }
  .player.playing .eq i:nth-child(1) { animation-delay:0s; }
  .player.playing .eq i:nth-child(2) { animation-delay:-.35s; }
  .player.playing .eq i:nth-child(3) { animation-delay:-.6s; }
  .player.playing .eq i:nth-child(4) { animation-delay:-.2s; }
  .player.playing .eq i:nth-child(5) { animation-delay:-.5s; }
  @keyframes eqbop { 0%,100% { height:26%; } 35% { height:96%; } 70% { height:50%; } }

  .lyric { margin-top:12px; min-height:20px; text-align:center; font-size:12.5px;
           color:var(--text-2); transition:opacity .25s ease; overflow:hidden;
           white-space:nowrap; text-overflow:ellipsis; }
  .lyric.swap { opacity:0; }
  .lyric.on { color:var(--accent); font-weight:600; }

  .pgwrap { margin-top:10px; }
  .pg { height:8px; background:var(--bg-tint); border-radius:4px; overflow:hidden; cursor:pointer; }
  .pg .fill { height:100%; width:0%;
              background:linear-gradient(90deg, var(--accent-2), var(--accent));
              clip-path:polygon(0 0, 100% 0, calc(100% - 5px) 100%, 0 100%);
              border-radius:4px 0 0 4px; transition:width .25s linear; }
  .pg-lab { display:flex; justify-content:space-between; font-family:var(--mono);
            font-size:11px; color:var(--text-3); margin-top:6px; }

  .ctrls { display:flex; align-items:center; justify-content:center; gap:18px; margin-top:10px; }
  .ctrls button { border:none; background:transparent; color:var(--text-2); cursor:pointer;
                  width:38px; height:38px; border-radius:50%;
                  display:flex; align-items:center; justify-content:center; transition:all .18s ease; }
  .ctrls button svg { width:17px; height:17px; display:block; }
  .ctrls button:hover:not(:disabled) { background:var(--bg-tint); color:var(--text); }
  .ctrls button:disabled { opacity:.3; cursor:default; }
  .ctrls .big { width:48px; height:48px; background:var(--accent); color:var(--on-accent); }
  .ctrls .big svg { width:19px; height:19px; }
  .ctrls .big:hover:not(:disabled) { background:var(--accent); color:var(--on-accent);
        filter:brightness(1.07); transform:translateY(-1px); box-shadow:var(--shadow); }
  .big .i-pause { display:none; }
  .player.playing .big .i-play { display:none; }
  .player.playing .big .i-pause { display:block; }

  .queue { margin-top:14px; border-top:1px solid var(--border); padding-top:10px;
           max-height:172px; overflow-y:auto; }
  .qrow { display:flex; align-items:center; gap:9px; padding:6px 8px; cursor:pointer;
          border-radius:var(--radius-s); transition:background .15s ease; }
  .qrow:hover { background:var(--bg-tint); }
  .qrow .no { font-family:var(--mono); font-size:10.5px; color:var(--text-3); width:18px;
              flex-shrink:0; text-align:right; }
  .qrow .qt { flex:1; min-width:0; font-size:12.5px; white-space:nowrap; overflow:hidden;
              text-overflow:ellipsis; }
  .qrow .qa { font-size:11px; color:var(--text-3); flex-shrink:0; max-width:96px;
              white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .qrow.cur { background:var(--accent-soft); }
  .qrow.cur .qt { color:var(--accent); font-weight:600; }
  .qrow.cur .no { color:var(--accent); }

  .err { color:var(--text-3); font-size:13px; padding:6px 2px; }
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after { animation-duration:.01ms !important; }
  }
`;

let cachedJs: string | null = null;

function widgetJs(): string {
  if (cachedJs !== null) return cachedJs;
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const jsPath = resolve(here, "widget/music-widget.global.js");
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
