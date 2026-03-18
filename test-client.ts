import { Receipt } from "mppx";
import { Mppx, tempo } from "mppx/client";
import { privateKeyToAccount } from "viem/accounts";

const SERVER_URL = process.env.SERVER_URL || "http://localhost:8787";
const PRIVATE_KEY = process.env.PRIVATE_KEY as `0x${string}` | undefined;
const TARGET_PATH = process.env.TARGET_PATH || "/__mpp/protected";

if (!PRIVATE_KEY) {
  console.error("Error: PRIVATE_KEY environment variable is required");
  console.log("Usage: PRIVATE_KEY=0x... npm run test:client");
  process.exit(1);
}

async function main() {
  const privateKey = PRIVATE_KEY;
  if (!privateKey) {
    throw new Error("PRIVATE_KEY environment variable is required");
  }

  const account = privateKeyToAccount(privateKey);
  const targetUrl = `${SERVER_URL}${TARGET_PATH}`;

  console.log("Testing MPP payment flow\n");
  console.log(`Server: ${SERVER_URL}`);
  console.log(`Route: ${TARGET_PATH}`);
  console.log(`Wallet: ${account.address}\n`);

  console.log("1. Requesting the route without payment...");
  const initialResponse = await fetch(targetUrl);
  if (initialResponse.status !== 402) {
    console.error(`Expected 402, got ${initialResponse.status}`);
    process.exit(1);
  }

  const challengeHeader = initialResponse.headers.get("WWW-Authenticate");
  console.log("Received 402 Payment Required");
  console.log(`WWW-Authenticate: ${challengeHeader ? "present" : "missing"}\n`);

  console.log("2. Paying with mppx/client...");
  const mppx = Mppx.create({
    methods: [tempo({ account })],
    polyfill: false,
  });
  const paidResponse = await mppx.fetch(targetUrl);

  if (!paidResponse.ok) {
    console.error(`Payment failed with status ${paidResponse.status}`);
    console.error(await paidResponse.text());
    process.exit(1);
  }

  const receipt = Receipt.fromResponse(paidResponse);
  const setCookieHeader = paidResponse.headers.get("set-cookie");
  const authToken = setCookieHeader?.match(/auth_token=([^;]+)/)?.[1] ?? "";

  console.log("Payment succeeded");
  console.log(`Receipt method: ${receipt.method}`);
  console.log(`Receipt reference: ${receipt.reference}`);
  console.log(`Cookie received: ${authToken ? "yes" : "no"}\n`);

  if (!authToken) {
    console.warn("No auth cookie was set; skipping cookie re-check.");
    return;
  }

  console.log("3. Reusing the JWT cookie without another payment...");
  const cookieResponse = await fetch(targetUrl, {
    headers: {
      Cookie: `auth_token=${authToken}`,
    },
  });

  if (!cookieResponse.ok) {
    console.error(`Cookie auth failed with status ${cookieResponse.status}`);
    process.exit(1);
  }

  console.log("Cookie authentication succeeded\n");
  console.log("All checks passed:");
  console.log("- 402 challenge was returned");
  console.log("- mppx created and submitted a payment credential");
  console.log("- Payment-Receipt was returned");
  console.log("- JWT cookie bypassed a second payment");
}

main().catch((error) => {
  console.error("\nTest failed:");
  console.error(error);
  process.exit(1);
});
