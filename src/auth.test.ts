import assert from "node:assert/strict";
import { test } from "node:test";
import { Hono } from "hono";
import { createProtectedRoute } from "./auth";
import type { AppContext, Env } from "./env";

test("protected routes return an MPP payment challenge", async () => {
  const app = new Hono<AppContext>();
  app.use(
    "/paid",
    createProtectedRoute({
      amount: "0.01",
      description: "Test payment",
      pattern: "/paid",
    }),
  );
  app.get("/paid", (c) => c.text("paid"));

  const env: Env = {
    JWT_SECRET: "test-jwt-secret-000000000000000000000000000000000000",
    MPP_SECRET_KEY: "test-mpp-secret-000000000000000000000000000000000000",
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

  const response = await app.request("http://localhost/paid", undefined, env);

  assert.equal(response.status, 402);
  assert.match(
    response.headers.get("www-authenticate") ?? "",
    /intent="charge"/,
  );
});
