/**
 * JWT utility functions using Web Crypto API (crypto.subtle)
 * Implements stateless authentication with HMAC-SHA256 signatures
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

export interface JWTPayload {
  paid: boolean; // indicates payment was verified
  iat: number; // issued at (seconds since epoch)
  exp: number; // expires at (seconds since epoch)
  scope: JWTAccessScope; // route/payment scope this token authorizes
}

/**
 * Base64URL encoding (URL-safe base64 without padding)
 */
function base64UrlEncode(data: BufferSource): string {
  // Convert to Uint8Array if it's an ArrayBuffer
  const bytes = ArrayBuffer.isView(data)
    ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
    : new Uint8Array(data);
  const base64 = btoa(String.fromCharCode(...bytes));
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

/**
 * Base64URL decoding
 */
function base64UrlDecode(str: string): Uint8Array {
  // Add padding back
  const paddedStr = str + "==".substring(0, (4 - (str.length % 4)) % 4);
  // Replace URL-safe characters
  const base64 = paddedStr.replace(/-/g, "+").replace(/_/g, "/");
  // Decode
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Convert string to Uint8Array
 */
function stringToArrayBuffer(str: string): Uint8Array {
  const encoder = new TextEncoder();
  return encoder.encode(str);
}

/**
 * Convert BufferSource to string
 */
function arrayBufferToString(buffer: BufferSource): string {
  const decoder = new TextDecoder();
  return decoder.decode(buffer);
}

/**
 * Import the JWT secret as a CryptoKey for HMAC operations
 */
async function importSecretKey(secret: string): Promise<CryptoKey> {
  const keyData = stringToArrayBuffer(secret);
  return await crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
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

  // JWT Header
  const header = {
    alg: "HS256",
    typ: "JWT",
  };

  // JWT Payload
  const payload: JWTPayload = {
    paid: true,
    iat: now,
    exp: now + expiresInSeconds,
    scope,
  };

  // Encode header and payload
  const encodedHeader = base64UrlEncode(
    stringToArrayBuffer(JSON.stringify(header)),
  );
  const encodedPayload = base64UrlEncode(
    stringToArrayBuffer(JSON.stringify(payload)),
  );

  // Create signature
  const dataToSign = `${encodedHeader}.${encodedPayload}`;
  const key = await importSecretKey(secret);
  const signatureBuffer = await crypto.subtle.sign(
    "HMAC",
    key,
    stringToArrayBuffer(dataToSign),
  );
  const encodedSignature = base64UrlEncode(signatureBuffer);

  // Return complete JWT
  return `${dataToSign}.${encodedSignature}`;
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
    // Split token into parts
    const parts = token.split(".");
    if (parts.length !== 3) {
      return null;
    }

    const [encodedHeader, encodedPayload, encodedSignature] = parts;

    // Verify signature
    const dataToVerify = `${encodedHeader}.${encodedPayload}`;
    const key = await importSecretKey(secret);
    const signatureBuffer = base64UrlDecode(encodedSignature);

    const isValid = await crypto.subtle.verify(
      "HMAC",
      key,
      signatureBuffer,
      stringToArrayBuffer(dataToVerify),
    );

    if (!isValid) {
      return null;
    }

    // Decode and parse payload
    const payloadBuffer = base64UrlDecode(encodedPayload);
    const payloadStr = arrayBufferToString(payloadBuffer);
    const payload = JSON.parse(payloadStr) as JWTPayload;

    // Check required claims and expiration
    const now = Math.floor(Date.now() / 1000);
    if (payload.paid !== true || payload.exp < now || !payload.scope) {
      return null;
    }

    if (expectedScope && !scopesMatch(payload.scope, expectedScope)) {
      return null;
    }

    return payload;
  } catch {
    // Invalid token format or parsing error
    return null;
  }
}
