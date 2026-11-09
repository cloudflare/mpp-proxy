import { createReplayStore } from "../src/replay-store";
import type { Env } from "../src/env";

// Test-only entry point. Production exports no store-management endpoints.
export default {
  async fetch(request: Request, env: Env) {
    const store = createReplayStore(env.PAYMENT_STORE);
    const path = new URL(request.url).pathname;
    if (path === "/expired") {
      return Response.json(await store.tryClaim?.("expired", Date.now() - 1));
    }
    if (path === "/claim") {
      return Response.json(
        await store.tryClaim?.("lifecycle", Date.now() + 150),
      );
    }
    const value = await store.update("counter", (current) => {
      const next = Number(current ?? 0) + 1;
      return { op: "set", value: next, result: next };
    });
    return Response.json(value);
  },
};
