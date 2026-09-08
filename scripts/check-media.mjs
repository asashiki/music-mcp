import { readFile } from 'node:fs/promises';

// Run from the VPS and a second machine to distinguish an internal MCP
// connection from the public media origin that the user's browser must reach.
export async function checkMedia(url, kind) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(url, {
      headers: kind === 'audio' ? { Range: 'bytes=0-1023' } : {},
      signal: controller.signal,
    });
    const mime = (response.headers.get('content-type') || '').split(';')[0];
    const reader = response.body?.getReader();
    const first = await reader?.read();
    await reader?.cancel(); // Never download an entire song for this check.
    const bytes = first?.value ?? new Uint8Array();
    const prefix = new TextDecoder().decode(bytes.subarray(0, 160)).trim();
    const wrongBody = /^</.test(prefix) || (kind !== 'lyrics' && /^[{[]/.test(prefix));
    const mediaType = kind === 'audio' ? /^audio\/|^application\/octet-stream$/
      : kind === 'cover' ? /^image\// : /^text\//;
    const ok = response.ok && bytes.length > 0 && mediaType.test(mime) && !wrongBody;
    return { kind, url, ok, status: response.status, mime,
      contentRange: response.headers.get('content-range'),
      receivedBytes: bytes.length,
      issue: ok ? null : !response.ok ? 'HTTP error' : !bytes.length ? 'Empty response'
        : wrongBody ? 'Returned text/JSON/HTML instead of media' : 'Unexpected content type' };
  } catch (error) {
    return { kind, url, ok: false, issue: error.name === 'AbortError' ? 'Request timed out'
      : `Network failure: ${error.cause?.code ?? error.name}` };
  } finally { clearTimeout(timeout); }
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  const filename = process.argv[2];
  if (!filename) {
    console.error('Usage: node scripts/check-media.mjs tool-result.json');
    process.exitCode = 2;
  } else {
    const raw = JSON.parse(await readFile(filename, 'utf8'));
    const payload = raw.structuredContent ?? raw;
    const track = payload.queue?.[payload.startIndex ?? 0];
    if (!track) throw new Error('Expected a real play_song/play_playlist structuredContent result.');
    const results = await Promise.all([
      checkMedia(track.audioUrl, 'audio'), checkMedia(track.coverUrl, 'cover'), checkMedia(track.lrcUrl, 'lyrics')
    ]);
    console.log(JSON.stringify({ scope: 'Public HTTP media only; browser decoding and ChatGPT CSP are not verified', results }, null, 2));
    if (results.some(result => !result.ok)) process.exitCode = 1;
  }
}
