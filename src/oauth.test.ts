import assert from "node:assert/strict";
import crypto from "node:crypto";
import http from "node:http";
import test from "node:test";
import express from "express";
import { setupOAuth } from "./oauth.js";

async function listen(server: http.Server): Promise<string> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return `http://127.0.0.1:${address.port}`;
}

async function createOAuthFixture() {
  const app = express();
  const server = http.createServer(app);
  const baseUrl = await listen(server);
  const resourceUrl = `${baseUrl}/mcp/music`;
  const bearerAuth = setupOAuth(app, {
    baseUrl,
    resourceUrl,
    password: "correct horse battery staple",
    tokenSecret: "test-token-signing-secret",
    serviceName: "music-mcp test",
    scope: "tools:read",
    allowLegacyResourceOmission: false
  });
  app.get("/protected", bearerAuth, (_req, res) => res.json({ ok: true }));
  return {
    baseUrl,
    resourceUrl,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  };
}

async function register(baseUrl: string, redirectUri = "https://chat.example/callback") {
  const response = await fetch(`${baseUrl}/oauth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ redirect_uris: [redirectUri], client_name: "Test client" })
  });
  return { response, body: await response.json() as { client_id?: string; error?: string } };
}

function pkce() {
  const verifier = "test-verifier-abcdefghijklmnopqrstuvwxyz-0123456789-ABCDE";
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

async function authorize(
  baseUrl: string,
  resourceUrl: string,
  clientId: string,
  redirectUri: string,
  challenge: string,
  password = "correct horse battery staple"
) {
  const body = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    code_challenge: challenge,
    code_challenge_method: "S256",
    resource: resourceUrl,
    scope: "tools:read",
    state: "state-123",
    password
  });
  return fetch(`${baseUrl}/oauth/authorize`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
    redirect: "manual"
  });
}

test("OAuth enforces safe redirects, RFC 8707 resource and S256 PKCE", async () => {
  const fixture = await createOAuthFixture();
  try {
    const unsafe = await register(fixture.baseUrl, "http://remote.example/callback");
    assert.equal(unsafe.response.status, 400);
    assert.equal(unsafe.body.error, "invalid_client_metadata");

    const { response: registration, body: client } = await register(fixture.baseUrl);
    assert.equal(registration.status, 201);
    assert.ok(client.client_id);

    const { verifier, challenge } = pkce();
    const missingResource = new URL(`${fixture.baseUrl}/oauth/authorize`);
    missingResource.search = new URLSearchParams({
      response_type: "code",
      client_id: client.client_id,
      redirect_uri: "https://chat.example/callback",
      code_challenge: challenge,
      code_challenge_method: "S256"
    }).toString();
    const missingResponse = await fetch(missingResource);
    assert.equal(missingResponse.status, 400);
    assert.deepEqual(await missingResponse.json(), { error: "invalid_request" });

    const pageUrl = new URL(`${fixture.baseUrl}/oauth/authorize`);
    pageUrl.search = new URLSearchParams({
      response_type: "code",
      client_id: client.client_id,
      redirect_uri: "https://chat.example/callback",
      code_challenge: challenge,
      code_challenge_method: "S256",
      resource: fixture.resourceUrl,
      scope: "tools:read"
    }).toString();
    const page = await fetch(pageUrl);
    assert.equal(page.status, 200);
    assert.match(page.headers.get("content-security-policy") ?? "", /frame-ancestors 'none'/);
    assert.match(await page.text(), /type="password"/);

    const approved = await authorize(
      fixture.baseUrl,
      fixture.resourceUrl,
      client.client_id,
      "https://chat.example/callback",
      challenge
    );
    assert.equal(approved.status, 302);
    const callback = new URL(approved.headers.get("location") ?? "");
    assert.equal(callback.origin, "https://chat.example");
    assert.equal(callback.searchParams.get("state"), "state-123");
    assert.equal(callback.searchParams.get("iss"), fixture.baseUrl);
    const code = callback.searchParams.get("code");
    assert.ok(code);

    const tokenResponse = await fetch(`${fixture.baseUrl}/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        client_id: client.client_id,
        redirect_uri: "https://chat.example/callback",
        code_verifier: verifier,
        resource: fixture.resourceUrl
      })
    });
    assert.equal(tokenResponse.status, 200);
    const token = await tokenResponse.json() as { access_token?: string; scope?: string };
    assert.match(token.access_token ?? "", /^mcp\./);
    assert.equal(token.scope, "tools:read");

    const protectedResponse = await fetch(`${fixture.baseUrl}/protected`, {
      headers: { authorization: `Bearer ${token.access_token}` }
    });
    assert.equal(protectedResponse.status, 200);
    assert.deepEqual(await protectedResponse.json(), { ok: true });

    const replay = await fetch(`${fixture.baseUrl}/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        client_id: client.client_id,
        redirect_uri: "https://chat.example/callback",
        code_verifier: verifier,
        resource: fixture.resourceUrl
      })
    });
    assert.equal(replay.status, 400);
    assert.deepEqual(await replay.json(), { error: "invalid_grant" });
  } finally {
    await fixture.close();
  }
});

test("OAuth rejects a bad verifier and never reflects the authorization password", async () => {
  const fixture = await createOAuthFixture();
  try {
    const { body: client } = await register(fixture.baseUrl);
    assert.ok(client.client_id);
    const { verifier, challenge } = pkce();

    const denied = await authorize(
      fixture.baseUrl,
      fixture.resourceUrl,
      client.client_id,
      "https://chat.example/callback",
      challenge,
      "this must never leak"
    );
    assert.equal(denied.status, 403);
    const deniedText = await denied.text();
    assert.doesNotMatch(deniedText, /this must never leak/);
    assert.equal(denied.headers.get("location"), null);

    const approved = await authorize(
      fixture.baseUrl,
      fixture.resourceUrl,
      client.client_id,
      "https://chat.example/callback",
      challenge
    );
    const code = new URL(approved.headers.get("location") ?? "").searchParams.get("code");
    assert.ok(code);
    const badVerifier = await fetch(`${fixture.baseUrl}/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        client_id: client.client_id,
        redirect_uri: "https://chat.example/callback",
        code_verifier: verifier.replace("ABCDE", "XXXXX"),
        resource: fixture.resourceUrl
      })
    });
    assert.equal(badVerifier.status, 400);
    assert.deepEqual(await badVerifier.json(), { error: "invalid_grant" });

    const unauthorized = await fetch(`${fixture.baseUrl}/protected`);
    assert.equal(unauthorized.status, 401);
    assert.match(unauthorized.headers.get("www-authenticate") ?? "", /oauth-protected-resource\/mcp\/music/);
  } finally {
    await fixture.close();
  }
});
