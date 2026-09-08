import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { getSong } from "./meting.js";

test("getSong falls back to the requested id when Meting omits ids from sub-URLs", async () => {
  const server = http.createServer((_req, res) => {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify([{ name: "Fallback Song", artist: "Fallback Artist" }]));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  try {
    const track = await getSong(`http://127.0.0.1:${address.port}/meting`, "netease", "825522");
    assert.deepEqual(track, {
      songId: "825522",
      server: "netease",
      title: "Fallback Song",
      artist: "Fallback Artist",
      picId: "825522"
    });
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
