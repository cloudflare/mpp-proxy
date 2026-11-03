import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { setTimeout } from "node:timers/promises";
import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { Challenge, Credential } from "mppx";
import { Attribution } from "mppx/tempo";
import { encodeAbiParameters, encodeEventTopics, parseAbiItem } from "viem";

// Synthetic fixture values and public token defaults; no captured payment data.
const recipient = "0x000000000000000000000000000000000000dEaD";
const sender = "0x1111111111111111111111111111111111111111";
const currency = "0x20c0000000000000000000000000000000000000";
const url = "https://merchant.example/__mpp/protected";

async function bundle(entry: string) {
  const result = await build({
    entryPoints: [entry],
    bundle: true,
    write: false,
    format: "esm",
    platform: "neutral",
    mainFields: ["module", "main"],
    conditions: ["workerd", "worker"],
    external: ["cloudflare:*", "node:*"],
  });
  return result.outputFiles[0].text;
}

function receipt(hash: `0x${string}`, memo?: `0x${string}`) {
  const event = parseAbiItem(
    memo
      ? "event TransferWithMemo(address indexed from, address indexed to, uint256 amount, bytes32 indexed memo)"
      : "event Transfer(address indexed from, address indexed to, uint256 amount)",
  );
  const blockHash = `0x${"12".repeat(32)}`;
  return {
    transactionHash: hash,
    transactionIndex: "0x0",
    blockHash,
    blockNumber: "0x1",
    from: sender,
    to: currency,
    cumulativeGasUsed: "0x5208",
    gasUsed: "0x5208",
    effectiveGasPrice: "0x1",
    contractAddress: null,
    logsBloom: `0x${"00".repeat(256)}`,
    status: "0x1",
    type: "0x0",
    logs: [
      {
        address: currency,
        topics: encodeEventTopics({
          abi: [event],
          args: { from: sender, to: recipient, ...(memo ? { memo } : {}) },
        }),
        data: encodeAbiParameters([{ type: "uint256" }], [10000n]),
        blockHash,
        blockNumber: "0x1",
        transactionHash: hash,
        transactionIndex: "0x0",
        logIndex: "0x0",
        removed: false,
      },
    ],
  };
}

test("payment verification and replay protection across isolates and restarts", async (t) => {
  const receipts = new Map<string, ReturnType<typeof receipt>>();
  let originRequests = 0;
  const rpc = createServer(async (req, res) => {
    if (req.url === "/premium/report.txt") {
      originRequests++;
      res.end("premium origin content");
      return;
    }
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    const respond = (call: {
      id: number;
      method: string;
      params: string[];
    }) => ({
      jsonrpc: "2.0",
      id: call.id,
      result:
        call.method === "eth_getTransactionReceipt"
          ? (receipts.get(call.params[0]) ?? null)
          : null,
    });
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify(Array.isArray(body) ? body.map(respond) : respond(body)),
    );
  });
  await new Promise<void>((resolve) => rpc.listen(0, "127.0.0.1", resolve));
  const address = rpc.address();
  assert.ok(address && typeof address !== "string");
  const directory = await mkdtemp(join(tmpdir(), "mpp-replay-"));
  let mf: Miniflare | undefined;
  t.after(async () => {
    await mf?.dispose();
    await new Promise<void>((resolve, reject) =>
      rpc.close((error) => (error ? reject(error) : resolve())),
    );
    await rm(directory, { recursive: true, force: true });
  });
  const [script, storeScript] = await Promise.all([
    bundle("src/index.ts"),
    bundle("tests/store-worker.ts"),
  ]);
  const bindings = {
    JWT_SECRET: "test-jwt-secret-000000000000000000000000000000000000",
    MPP_SECRET_KEY: "test-mpp-secret-000000000000000000000000000000000000",
    PAYMENT_CURRENCY: currency,
    PAY_TO: recipient,
    PROTECTED_PATTERNS: [
      { pattern: "/premium/*", amount: "0.01", description: "Premium content" },
    ],
    TEMPO_TESTNET: true,
    TEMPO_RPC_URL: `http://127.0.0.1:${address.port}`,
    ORIGIN_URL: `http://127.0.0.1:${address.port}`,
  };
  const sharedBinding = {
    PAYMENT_STORE: {
      className: "PaymentReplayStore",
      scriptName: "proxy-a",
      useSQLite: true,
    },
  };
  const options = {
    resourcePersistencePath: directory,
    workers: [
      ...["proxy-a", "proxy-b", "missing-store"].map((name) => ({
        name,
        script,
        modules: true,
        compatibilityDate: "2026-11-03",
        compatibilityFlags: ["nodejs_compat"],
        bindings,
        durableObjects: name === "missing-store" ? {} : sharedBinding,
      })),
      ...["store-a", "store-b"].map((name) => ({
        name,
        script: storeScript,
        modules: true,
        compatibilityDate: "2026-11-03",
        compatibilityFlags: ["nodejs_compat"],
        durableObjects: sharedBinding,
      })),
    ],
  };
  mf = new Miniflare(convertV4MiniflareOptions(options));
  const request = async (
    worker: string,
    authorization?: string,
    target = url,
  ) => {
    assert.ok(mf);
    return (await mf.getWorker(worker)).fetch(target, {
      headers: authorization ? { Authorization: authorization } : {},
    });
  };
  async function challenge(target = url) {
    const response = await request("proxy-a", undefined, target);
    assert.equal(response.status, 402);
    assert.equal(response.headers.get("cache-control"), "no-store");
    return Challenge.deserialize(
      response.headers.get("www-authenticate") ?? "",
    );
  }
  const credential = (challenge: Challenge.Challenge, hash: `0x${string}`) =>
    Credential.serialize({ challenge, payload: { type: "hash", hash } });
  const hash = `0x${"ab".repeat(32)}` as const;
  const original = await challenge();
  const header = credential(original, hash);

  await t.test(
    "rejects payment receipts missing the required attribution memo",
    async () => {
      receipts.set(hash, receipt(hash));
      const response = await request("proxy-a", header);
      assert.equal(response.status, 403);
      assert.match(
        await response.text(),
        /memo is not bound to this challenge/,
      );
      assert.equal(response.headers.get("set-cookie"), null);
      assert.equal(response.headers.get("payment-receipt"), null);
    },
  );
  await t.test(
    "accepts a bound payment and preserves cookie access",
    async () => {
      receipts.set(
        hash,
        receipt(
          hash,
          Attribution.encode({
            challengeId: original.id,
            serverId: original.realm,
          }),
        ),
      );
      const response = await request("proxy-a", header);
      assert.equal(response.status, 200, await response.clone().text());
      assert.ok(response.headers.get("payment-receipt"));
      const cookie = response.headers.get("set-cookie")?.split(";")[0];
      assert.ok(cookie);
      assert.ok(mf);
      const reused = await (
        await mf.getWorker("proxy-b")
      ).fetch(url, { headers: { Cookie: cookie } });
      assert.equal(reused.status, 200);
    },
  );
  await t.test(
    "rejects an identical credential in a different isolate",
    async () => {
      const response = await request("proxy-b", header);
      assert.equal(response.status, 403);
      assert.match(await response.text(), /already been used/);
      assert.equal(response.headers.get("set-cookie"), null);
      assert.equal(response.headers.get("payment-receipt"), null);
    },
  );
  await t.test("rejects the payment under a different challenge", async () => {
    const fresh = await challenge();
    assert.notEqual(fresh.id, original.id);
    const response = await request("proxy-b", credential(fresh, hash));
    assert.equal(response.status, 403);
    assert.match(await response.text(), /memo is not bound to this challenge/);
  });
  await t.test("only one concurrent request consumes a payment", async () => {
    const fresh = await challenge();
    const concurrentHash = `0x${"cd".repeat(32)}` as const;
    receipts.set(
      concurrentHash,
      receipt(
        concurrentHash,
        Attribution.encode({ challengeId: fresh.id, serverId: fresh.realm }),
      ),
    );
    const responses = await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        request(
          i % 2 ? "proxy-a" : "proxy-b",
          credential(fresh, concurrentHash),
        ),
      ),
    );
    assert.equal(
      responses.filter((response) => response.status === 200).length,
      1,
    );
    assert.equal(
      responses.filter((response) => response.status === 403).length,
      11,
    );
  });
  await t.test("fails closed without a replay-store binding", async () => {
    const response = await request("missing-store", header);
    assert.equal(response.status, 500);
    assert.equal(response.headers.get("set-cookie"), null);
  });
  await t.test(
    "configured origin routes stay protected and support valid payments",
    async () => {
      const target = "https://merchant.example/premium/report.txt";
      const fresh = await challenge(target);
      const paymentHash = `0x${"ef".repeat(32)}` as const;
      receipts.set(paymentHash, receipt(paymentHash));
      const authorization = credential(fresh, paymentHash);
      const denied = await request("proxy-a", authorization, target);
      assert.equal(denied.status, 403);
      assert.equal(originRequests, 0);
      receipts.set(
        paymentHash,
        receipt(
          paymentHash,
          Attribution.encode({
            challengeId: fresh.id,
            serverId: fresh.realm,
          }),
        ),
      );
      const paid = await request("proxy-b", authorization, target);
      assert.equal(paid.status, 200, await paid.clone().text());
      assert.equal(await paid.text(), "premium origin content");
      assert.ok(paid.headers.get("payment-receipt"));
      assert.ok(paid.headers.get("set-cookie"));
      assert.equal(originRequests, 1);
    },
  );
  await t.test("atomic updates do not lose concurrent changes", async () => {
    assert.ok(mf);
    const workers = await Promise.all([
      mf.getWorker("store-a"),
      mf.getWorker("store-b"),
    ]);
    const responses = await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        workers[i % 2].fetch("https://store.test/increment"),
      ),
    );
    const results = await Promise.all(
      responses.map((response) => response.json()),
    );
    assert.deepEqual(
      results.sort((a, b) => Number(a) - Number(b)),
      Array.from({ length: 12 }, (_, i) => i + 1),
    );
    const expired = await workers[0].fetch("https://store.test/expired");
    assert.equal(await expired.json(), false);
  });
  await t.test("replay markers reject reuse until their expiry", async () => {
    assert.ok(mf);
    const worker = await mf.getWorker("store-a");
    assert.equal(
      await (await worker.fetch("https://store.test/claim")).json(),
      true,
    );
    assert.equal(
      await (await worker.fetch("https://store.test/claim")).json(),
      false,
    );
    await setTimeout(250);
    assert.equal(
      await (await worker.fetch("https://store.test/claim")).json(),
      true,
    );
  });
  await t.test(
    "consumed payments stay consumed after a runtime restart",
    async () => {
      assert.ok(mf);
      await mf.dispose();
      mf = new Miniflare(convertV4MiniflareOptions(options));
      const response = await request("proxy-b", header);
      assert.equal(response.status, 403);
      assert.match(await response.text(), /already been used/);
    },
  );
});
