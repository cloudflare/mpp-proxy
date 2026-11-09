import { DurableObject } from "cloudflare:workers";
import type { Env } from "./env";

/** One object per SDK key: claims are durable and atomic across all isolates. */
export class PaymentReplayStore extends DurableObject<Env> {
  get(): string | null {
    return this.ctx.storage.kv.get<string>("value") ?? null;
  }

  put(value: string): void {
    this.ctx.storage.kv.put("value", value);
  }

  delete(): void {
    this.ctx.storage.kv.delete("value");
  }

  compareAndSwap(current: string | null, next: string | null): boolean {
    // Synchronous storage operations do not yield to another RPC invocation.
    if (this.get() !== current) {
      return false;
    }
    if (next === null) {
      this.delete();
    } else {
      this.put(next);
    }
    return true;
  }

  async tryClaim(expires: number): Promise<boolean> {
    if (!Number.isFinite(expires) || expires <= Date.now()) {
      return false;
    }

    const raw = this.get();
    if (raw !== null) {
      const current = JSON.parse(raw);
      if (
        current?.type !== "mppx:replay" ||
        typeof current.expires !== "number" ||
        current.expires > Date.now()
      ) {
        return false;
      }
    }

    this.put(JSON.stringify({ type: "mppx:replay", expires }));
    await this.ctx.storage.setAlarm(expires);
    return true;
  }

  async alarm(): Promise<void> {
    const raw = this.get();
    if (raw === null) {
      return;
    }
    const current = JSON.parse(raw);
    if (current?.type !== "mppx:replay") {
      return;
    }
    if (current.expires <= Date.now()) {
      await this.ctx.storage.deleteAll();
    } else {
      // An older alarm may run after an expired key has been claimed again.
      await this.ctx.storage.setAlarm(current.expires);
    }
  }
}
