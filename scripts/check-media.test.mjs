import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import { checkMedia } from './check-media.mjs';

test('public media check rejects HTTP 200 error bodies and distinguishes audio, cover, lyrics', async () => {
  const server = createServer((req, res) => {
    const cases = {
      '/audio': ['audio/mpeg', Buffer.from([0xff, 0xfb, 0x90, 0x64])],
      '/cover': ['image/png', Buffer.from([137, 80, 78, 71])],
      '/lyrics': ['text/plain', '[ar:Artist]\n[00:01.00]Lyric'],
      '/html': ['text/html', '<html>Bad gateway</html>'],
      '/json': ['audio/mpeg', '{"error":"upstream failed"}'],
      '/empty': ['audio/mpeg', ''],
    };
    const [mime, body] = cases[req.url];
    res.setHeader('content-type', mime);
    if (req.url === '/audio') {
      assert.equal(req.headers.range, 'bytes=0-1023');
      res.statusCode = 206;
      res.setHeader('content-range', 'bytes 0-3/4');
    }
    res.end(body);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    for (const [path, kind, ok] of [
      ['audio','audio',true], ['cover','cover',true], ['lyrics','lyrics',true],
      ['html','audio',false], ['json','audio',false], ['empty','audio',false]
    ]) assert.equal((await checkMedia(`${base}/${path}`, kind)).ok, ok, path);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
