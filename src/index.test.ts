import assert from "node:assert/strict";
import { test } from "node:test";
import type { Env } from "./env";
import app from "./index";

function createEnv(originHits: string[]): Env {
  const origin = {
    async fetch(request: RequestInfo | URL): Promise<Response> {
      const url = new URL(
        request instanceof Request ? request.url : request.toString(),
      );
      originHits.push(`${url.pathname}${url.search}`);
      return new Response("origin response");
    },
  } as unknown as Fetcher;

  return {
    JWT_SECRET: "test-jwt-secret-000000000000000000000000000000000000",
    MPP_SECRET_KEY: "test-mpp-secret-000000000000000000000000000000000000",
    ORIGIN_SERVICE: origin,
    PAYMENT_CURRENCY: "0x20c0000000000000000000000000000000000000",
    PAY_TO: "0x000000000000000000000000000000000000dEaD",
    PROTECTED_PATTERNS: [
      {
        amount: "0.01",
        description: "Access to premium content for 1 hour",
        pattern: "/premium/*",
      },
    ],
    TEMPO_TESTNET: true,
  };
}

test("non-canonical spellings of protected paths cannot bypass payment", async (t) => {
  const bypassPaths = [
    "/premium/secret",
    "//premium/secret",
    "/%2fpremium/secret",
    "/pre%6dium/secret",
    "/Premium/secret",
    "/other%5c..%5cpremium%5csecret",
  ];

  for (const path of bypassPaths) {
    await t.test(path, async () => {
      const originHits: string[] = [];
      const response = await app.request(
        `http://localhost${path}`,
        undefined,
        createEnv(originHits),
      );

      assert.equal(response.status, 402);
      assert.deepEqual(originHits, []);
    });
  }
});

test("non-canonical spelling of the built-in protected path requires payment", async () => {
  const originHits: string[] = [];
  const response = await app.request(
    "http://localhost//__mpp/protected",
    undefined,
    createEnv(originHits),
  );

  assert.equal(response.status, 402);
  assert.deepEqual(originHits, []);
});

test("the canonical path used for matching is forwarded to the origin", async () => {
  const originHits: string[] = [];
  const response = await app.request(
    "http://localhost/public//nested/%69tem?x=1",
    undefined,
    createEnv(originHits),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(originHits, ["/public/nested/item?x=1"]);
});

test("ambiguous paths are rejected instead of being passed to the origin", async () => {
  const originHits: string[] = [];
  const env = createEnv(originHits);

  for (const path of [
    "/%E0%A4%A",
    "/%00premium/secret",
    "/%252fpremium/secret",
  ]) {
    const response = await app.request(
      `http://localhost${path}`,
      undefined,
      env,
    );
    assert.equal(response.status, 400);
  }

  assert.deepEqual(originHits, []);
});
