/**
 * Environment bindings type definition
 *
 * Extends the auto-generated CloudflareBindings with secrets that come from
 * .dev.vars locally or `wrangler secret put` in production.
 */

import type { JWTPayload } from "./jwt";

export interface Env extends Omit<
  CloudflareBindings,
  "PAY_TO" | "PAYMENT_CURRENCY" | "TEMPO_TESTNET"
> {
  /** Secret for signing JWT tokens - set via .dev.vars locally or `wrangler secret put` in production */
  JWT_SECRET: string;
  /** Secret for signing MPP payment challenges */
  MPP_SECRET_KEY: string;
  /** Wallet that receives Tempo payments */
  PAY_TO: `0x${string}`;
  /** Token address the proxy charges in */
  PAYMENT_CURRENCY: `0x${string}`;
  /** Whether the demo should use Tempo testnet defaults */
  TEMPO_TESTNET: boolean;
  /** Optional authenticated Tempo RPC URL for server-side verification and broadcast */
  TEMPO_RPC_URL?: string;
  /**
   * Optional origin URL for External Origin mode.
   * When set, requests are rewritten to this URL instead of using DNS-based routing.
   * Use this to proxy to another Worker on a Custom Domain or any external service.
   */
  ORIGIN_URL?: string;
  /** Optional: Service Binding to origin Worker */
  ORIGIN_SERVICE?: Fetcher;
}

/** Full app context type for Hono */
export interface AppContext {
  Bindings: Env;
  Variables: {
    auth?: JWTPayload;
  };
}
