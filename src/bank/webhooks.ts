import { createHmac, timingSafeEqual } from "node:crypto";

export type EventOutcome = "settled" | "failed" | "pending";

export interface WebhookEvent {
  id: string;
  name: string;
  accountId?: string;
  data?: { id?: string; status?: string; request_id?: string };
}

/**
 * Receives Airwallex webhooks for connected account transfers and charges.
 *
 * Signature (Airwallex docs, "Verify webhook signatures"): HMAC-SHA256, keyed with the
 * notification URL's secret, over `x-timestamp` + the raw request body, hex encoded in `x-signature`.
 * Verified on the raw body before parsing, and events older than the tolerance are refused.
 */
export class WebhookHub {
  private known = new Map<string, EventOutcome>();
  private waiters = new Map<string, ((o: EventOutcome) => void)[]>();
  private seenEvents = new Set<string>();
  /** Accepted and rejected deliveries, for the run record. */
  stats = { accepted: 0, rejected: 0, duplicates: 0 };

  constructor(
    private secret: string,
    private toleranceMs = 5 * 60_000,
    private now = () => Date.now(),
  ) {}

  verify(rawBody: string, timestamp: string | undefined, signature: string | undefined): boolean {
    if (!timestamp || !signature) return false;
    const expected = createHmac("sha256", this.secret).update(`${timestamp}${rawBody}`).digest("hex");
    const a = Buffer.from(expected);
    const b = Buffer.from(signature);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
    // x-timestamp is in milliseconds; accept seconds too.
    const ts = Number(timestamp);
    const ms = ts < 1e12 ? ts * 1000 : ts;
    return Number.isFinite(ms) && Math.abs(this.now() - ms) <= this.toleranceMs;
  }

  /** Handles one delivery. Returns the HTTP status to answer Airwallex with. */
  handle(rawBody: string, headers: Record<string, string | string[] | undefined>): number {
    const one = (h: string) => {
      const v = headers[h];
      return Array.isArray(v) ? v[0] : v;
    };
    if (!this.verify(rawBody, one("x-timestamp"), one("x-signature"))) {
      this.stats.rejected++;
      return 400;
    }
    let event: WebhookEvent;
    try {
      event = JSON.parse(rawBody) as WebhookEvent;
    } catch {
      this.stats.rejected++;
      return 400;
    }
    // Airwallex may deliver an event more than once; acknowledge repeats without acting twice.
    if (this.seenEvents.has(event.id)) {
      this.stats.duplicates++;
      return 200;
    }
    this.seenEvents.add(event.id);
    this.stats.accepted++;
    const objectId = event.data?.id;
    const outcome = outcomeOf(event.name);
    if (objectId && outcome) this.record(objectId, outcome);
    return 200;
  }

  /** Resolves when an event for this transfer or charge arrives (or already has). */
  waitFor(objectId: string): Promise<EventOutcome> {
    const known = this.known.get(objectId);
    if (known && known !== "pending") return Promise.resolve(known);
    return new Promise((resolve) => this.waiters.set(objectId, [...(this.waiters.get(objectId) ?? []), resolve]));
  }

  private record(objectId: string, outcome: EventOutcome) {
    if (this.known.get(objectId) === "settled" || this.known.get(objectId) === "failed") return;
    this.known.set(objectId, outcome);
    if (outcome === "pending") return;
    for (const resolve of this.waiters.get(objectId) ?? []) resolve(outcome);
    this.waiters.delete(objectId);
  }
}

/** connected_account_transfer.settled / charge.failed / ... -> outcome. Other events are ignored. */
export function outcomeOf(name: string): EventOutcome | undefined {
  if (!/^(connected_account_transfer|charge)\./.test(name)) return undefined;
  const status = name.split(".").at(-1);
  if (status === "settled") return "settled";
  if (status === "failed" || status === "suspended") return "failed";
  return "pending";
}

/** Builds headers the way Airwallex signs them. Used by tests and the local dry run. */
export function signForTest(secret: string, rawBody: string, timestamp = String(Date.now())) {
  return { "x-timestamp": timestamp, "x-signature": createHmac("sha256", secret).update(`${timestamp}${rawBody}`).digest("hex") };
}
