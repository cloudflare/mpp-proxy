/**
 * Authentication middleware for cookie-based JWT verification
 */

import { Context, Next, MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";
import { payment } from "mppx/hono";
import { Mppx, tempo } from "mppx/server";
import { createClient, http } from "viem";
import { tempo as tempoMainnet, tempoModerato } from "viem/chains";
import { verifyJWT } from "./jwt";
import type { AppContext, Env } from "./env";

/**
 * Creates a combined middleware that checks for valid cookie authentication
 * and conditionally applies payment middleware only if cookie auth fails
 *
 * @param paymentMiddleware - The payment middleware to apply when no valid cookie exists
 * @returns Combined authentication and payment middleware
 */
export function requirePaymentOrCookie(paymentMw: MiddlewareHandler) {
  return async (c: Context<AppContext>, next: Next) => {
    // Check for valid cookie
    const token = getCookie(c, "auth_token");

    if (token) {
      const jwtSecret = c.env.JWT_SECRET;

      // Ensure JWT_SECRET is configured
      if (!jwtSecret) {
        return c.json(
          {
            error:
              "Server misconfigured: JWT_SECRET not set. See README for setup instructions.",
          },
          500,
        );
      }

      const payload = await verifyJWT(token, jwtSecret);

      // If token is valid, skip payment and go directly to handler
      if (payload) {
        c.set("auth", payload);
        await next(); // Call the handler
        return;
      }
    }

    // No valid cookie - apply payment middleware
    return await paymentMw(c, next);
  };
}

/**
 * Configuration for a protected route that requires payment
 */
export interface ProtectedRouteConfig {
  /** Route pattern to protect (e.g., "/premium", "/api/paid/*") */
  pattern: string;
  /** Payment amount in token units (e.g. "0.01") */
  amount: string;
  /** Human-readable description of what the payment is for */
  description: string;
  /**
   * Bot Management Filtering (optional)
   * Requires Bot Management for Enterprise. See src/bot-management/ for details.
   */
  bot_score_threshold?: number;
  except_detection_ids?: number[];
}

/**
 * Creates middleware for a protected route that requires payment OR valid cookie
 * This dynamically creates payment middleware at request time to access environment variables
 * The route path is automatically determined from the request context
 *
 * @param config - Payment configuration
 * @returns Middleware that enforces payment or cookie authentication
 */
export function createProtectedRoute(config: ProtectedRouteConfig) {
  return async (c: Context<AppContext>, next: Next) => {
    const mppx = Mppx.create({
      methods: [
        tempo({
          currency: c.env.PAYMENT_CURRENCY,
          recipient: c.env.PAY_TO,
          testnet: c.env.TEMPO_TESTNET,
          ...(c.env.TEMPO_RPC_URL
            ? {
                getClient: createTempoClientResolver(c.env),
              }
            : {}),
        }),
      ],
      realm: new URL(c.req.url).host,
      secretKey: c.env.MPP_SECRET_KEY,
    });

    const paymentMw = payment(mppx.charge, {
      amount: config.amount,
      description: config.description,
    });

    // Apply the combined auth/payment middleware
    return await requirePaymentOrCookie(paymentMw)(c, next);
  };
}

function createTempoClientResolver(env: Env) {
  return ({ chainId }: { chainId?: number }) => {
    const chain = env.TEMPO_TESTNET
      ? tempoModerato
      : { ...tempoMainnet, experimental_preconfirmationTime: 500 };

    return createClient({
      chain: {
        ...chain,
        id: chainId ?? chain.id,
      },
      transport: http(env.TEMPO_RPC_URL),
    });
  };
}
