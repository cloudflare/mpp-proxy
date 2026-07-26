import { SignJWT, jwtVerify, type JWTPayload as JoseJWTPayload } from "jose";

/**
 * JWT utility functions using jose.
 * Implements stateless authentication with HMAC-SHA256 signatures.
 */

export interface JWTAccessScope {
  /** Schema version for future-compatible validation */
  version: 1;
  /** Payment method used for the charge */
  paymentMethod: "tempo";
  /** Hostname/realm the payment challenge was issued for */
  realm: string;
  /** Protected route pattern that was paid for */
  pattern: string;
  /** Amount paid for the protected route */
  amount: string;
  /** Token address used for payment */
  paymentCurrency: string;
  /** Recipient wallet for the payment */
  payTo: string;
  /** Tempo network selector */
  tempoTestnet: boolean;
}

export interface JWTPayload extends JoseJWTPayload {
  paid: boolean; // indicates payment was verified
  iat: number; // issued at (seconds since epoch)
  exp: number; // expires at (seconds since epoch)
  scope: JWTAccessScope; // route/payment scope this token authorizes
}

const JWT_ALGORITHM = "HS256";
const JWT_TYPE = "JWT";
const encoder = new TextEncoder();

function getSecretKey(secret: string): Uint8Array {
  return encoder.encode(secret);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isJWTAccessScope(scope: unknown): scope is JWTAccessScope {
  return (
    isRecord(scope) &&
    scope.version === 1 &&
    scope.paymentMethod === "tempo" &&
    typeof scope.realm === "string" &&
    typeof scope.pattern === "string" &&
    typeof scope.amount === "string" &&
    typeof scope.paymentCurrency === "string" &&
    typeof scope.payTo === "string" &&
    typeof scope.tempoTestnet === "boolean"
  );
}

function isJWTPayload(payload: JoseJWTPayload): payload is JWTPayload {
  return (
    payload.paid === true &&
    typeof payload.iat === "number" &&
    typeof payload.exp === "number" &&
    isJWTAccessScope(payload.scope)
  );
}

function scopesMatch(a: JWTAccessScope, b: JWTAccessScope): boolean {
  return (
    a.version === b.version &&
    a.paymentMethod === b.paymentMethod &&
    a.realm === b.realm &&
    a.pattern === b.pattern &&
    a.amount === b.amount &&
    a.paymentCurrency === b.paymentCurrency &&
    a.payTo === b.payTo &&
    a.tempoTestnet === b.tempoTestnet
  );
}

/**
 * Generate a JWT token
 * @param secret - The secret key for signing
 * @param scope - Route/payment scope this token authorizes
 * @param expiresInSeconds - Token validity duration (default: 3600 = 1 hour)
 * @returns JWT token string
 */
export async function generateJWT(
  secret: string,
  scope: JWTAccessScope,
  expiresInSeconds: number = 3600,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);

  return await new SignJWT({ paid: true, scope })
    .setProtectedHeader({ alg: JWT_ALGORITHM, typ: JWT_TYPE })
    .setIssuedAt(now)
    .setExpirationTime(now + expiresInSeconds)
    .sign(getSecretKey(secret));
}

/**
 * Verify and decode a JWT token
 * @param token - The JWT token to verify
 * @param secret - The secret key for verification
 * @param expectedScope - Optional route/payment scope the token must match
 * @returns Decoded payload if valid, null otherwise
 */
export async function verifyJWT(
  token: string,
  secret: string,
  expectedScope?: JWTAccessScope,
): Promise<JWTPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecretKey(secret), {
      algorithms: [JWT_ALGORITHM],
      typ: JWT_TYPE,
      requiredClaims: ["exp", "iat"],
    });

    if (!isJWTPayload(payload)) {
      return null;
    }

    if (expectedScope && !scopesMatch(payload.scope, expectedScope)) {
      return null;
    }

    return payload;
  } catch {
    // Invalid token format, signature, claims, expiration, or parsing error.
    return null;
  }
}
