import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { fetchWithRedirectPolicy, readTextLimited } from "./url-policy.js";

test("a trusted Meting endpoint cannot redirect media fetches into a private network", async () => {
  const target = http.createServer((_req, res) => res.end("private data"));
  const redirector = http.createServer((_req, res) => {
    const targetAddress = target.address();
    assert.ok(targetAddress && typeof targetAddress === "object");
    res.statusCode = 302;
    res.setHeader("location", `http://127.0.0.1:${targetAddress.port}/secret`);
    res.end();
  });
  await Promise.all([
    new Promise<void>((resolve) => target.listen(0, "127.0.0.1", resolve)),
    new Promise<void>((resolve) => redirector.listen(0, "127.0.0.1", resolve))
  ]);
  const address = redirector.address();
  assert.ok(address && typeof address === "object");
  try {
    await assert.rejects(
      fetchWithRedirectPolicy(`http://127.0.0.1:${address.port}/start`, {}, { allowPrivateInitialUrl: true }),
      /Blocked private or special-use media host/
    );
  } finally {
    await Promise.all([
      new Promise<void>((resolve, reject) => target.close((error) => error ? reject(error) : resolve())),
      new Promise<void>((resolve, reject) => redirector.close((error) => error ? reject(error) : resolve()))
    ]);
  }
});

test("small API responses are bounded even when Content-Length is absent", async () => {
  const oversized = new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(8));
      controller.enqueue(new Uint8Array(8));
      controller.close();
    }
  }));
  await assert.rejects(readTextLimited(oversized, 10), /exceeds 10 bytes/);
  assert.equal(await readTextLimited(new Response("lyrics"), 10), "lyrics");
});
