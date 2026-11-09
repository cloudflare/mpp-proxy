import { Store } from "mppx";
import type { PaymentReplayStore } from "./payment-replay-store";

/** Every isolate routes a given SDK key to the same Durable Object. */
export function createReplayStore(
  namespace: DurableObjectNamespace<PaymentReplayStore>,
): Store.AtomicStore {
  const store = Store.cloudflare({
    get: (key) => namespace.getByName(key).get(),
    put: (key, value) => namespace.getByName(key).put(value),
    delete: (key) => namespace.getByName(key).delete(),
    async update(key, fn) {
      const object = namespace.getByName(key);
      // RPC cannot transfer callbacks. Retry the SDK's pure update callback
      // locally until the object atomically accepts the corresponding change.
      for (;;) {
        const current = await object.get();
        const change = fn(current);
        if (change.op === "noop") {
          return change.result;
        }
        const next = change.op === "delete" ? null : change.value;
        if (await object.compareAndSwap(current, next)) {
          return change.result;
        }
      }
    },
  });

  return {
    ...store,
    tryClaim: (key, expires) => namespace.getByName(key).tryClaim(expires),
  };
}
