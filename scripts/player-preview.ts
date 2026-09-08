// Offline host fixture, built from the same bundle returned by resources/read.
// This tests browser interaction with a generated tone, not a streaming provider.
import { writeFileSync } from "node:fs";
import { musicWidgetHtml } from "../src/widget/music-widget-html.js";
const rate = 8000, seconds = 8, samples = rate * seconds;
const wav = Buffer.alloc(44 + samples * 2);
wav.write("RIFF", 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write("WAVEfmt ", 8);
wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 2, 28); wav.writeUInt16LE(2, 32);
wav.writeUInt16LE(16, 34); wav.write("data", 36); wav.writeUInt32LE(samples * 2, 40);
for (let i = 0; i < samples; i++) wav.writeInt16LE(Math.round(900 * Math.sin(i / rate * Math.PI * 2 * 440)), 44 + i * 2);
const data = { mode: "song", queue: [{ songId: "tone", server: "fixture", title: "播放器测试音调",
  artist: "本地生成 · 8 秒", audioUrl: `data:audio/wav;base64,${wav.toString("base64")}`, coverUrl: "", lrcUrl: "" }], startIndex: 0 };
const instrumentation = `<script>
window.openai={}; let firstAudio;
window.addEventListener('message',event=>{
 if(event.source!==parent)return;
 if(event.data.fixtureGlobals){Object.assign(window.openai,event.data.fixtureGlobals);window.dispatchEvent(new CustomEvent('openai:set_globals',{detail:{globals:event.data.fixtureGlobals}}));}
});
setInterval(()=>{
 const a=document.querySelector('audio');if(!a)return;firstAudio??=a;
 parent.postMessage({fixtureState:{sameAudio:firstAudio===a,time:a.currentTime,paused:a.paused,
 width:document.documentElement.clientWidth,scrollWidth:document.documentElement.scrollWidth,
 height:document.getElementById('root').getBoundingClientRect().height}},'*');
},200);
</script>`;
const widget = musicWidgetHtml().replace('<head>', '<head>'+instrumentation);
const encoded = JSON.stringify(widget).replace(/</g, '\\u003c');
const html = `<!doctype html><html><head><meta charset="utf-8"><title>Music player host fixture</title>
<style>body{font:15px system-ui;margin:32px;background:#fafafa;color:#222}button{font:inherit;padding:8px 12px;margin:0 6px 14px 0}iframe{display:block;width:720px;max-width:100%;height:180px;border:1px solid #e5e5e5;border-radius:20px;background:white}pre{white-space:pre-wrap}</style></head><body>
<p>离线宿主测试 · 自制测试音调，不连接音乐平台</p>
<button id="repeat">重放 50 次通知</button><button id="narrow">窄屏 320px</button><button id="wide">宽屏 720px</button><button id="theme">切换主题</button><button id="queue">测试歌单</button>
<iframe title="播放器" sandbox="allow-scripts"></iframe><pre id="state"></pre>
<script>
const frame=document.querySelector('iframe'),data=${JSON.stringify(data)};let sizes=0,dark=false;
const send=(method,params)=>frame.contentWindow.postMessage({jsonrpc:'2.0',method,params},'*');
window.addEventListener('message',event=>{
 if(event.source!==frame.contentWindow)return;
 const m=event.data;
 if(m.method==='ui/initialize')frame.contentWindow.postMessage({jsonrpc:'2.0',id:m.id,result:{protocolVersion:'2026-01-26',hostInfo:{name:'Offline fixture',version:'1'},hostCapabilities:{},hostContext:{theme:'light'}}},'*');
 if(m.method==='ui/notifications/initialized')send('ui/notifications/tool-result',{structuredContent:data});
 if(m.method==='ui/notifications/size-changed'){sizes++;frame.style.height=m.params.height+'px';frame.contentWindow.postMessage({fixtureGlobals:{maxHeight:m.params.height}},'*');}
 if(m.fixtureState)document.getElementById('state').textContent=JSON.stringify({...m.fixtureState,sizeNotifications:sizes},null,2);
});
document.getElementById('repeat').onclick=()=>{for(let i=0;i<50;i++){send('ui/notifications/tool-result',{structuredContent:data});frame.contentWindow.postMessage({fixtureGlobals:{toolOutput:data,theme:dark?'dark':'light'}},'*');}};
document.getElementById('narrow').onclick=()=>frame.style.width='320px';
document.getElementById('wide').onclick=()=>frame.style.width='720px';
document.getElementById('theme').onclick=()=>{dark=!dark;frame.style.background=dark?'#212121':'white';send('ui/notifications/host-context-changed',{theme:dark?'dark':'light'});};
document.getElementById('queue').onclick=()=>send('ui/notifications/tool-result',{structuredContent:{...data,mode:'playlist',queue:Array.from({length:12},(_,i)=>({...data.queue[0],songId:String(i),title:'测试音调 '+(i+1)}))}});
frame.srcdoc=${encoded};
</script></body></html>`;
writeFileSync("dist/player-preview.html", html);
console.log("Wrote dist/player-preview.html (offline fixture)");
