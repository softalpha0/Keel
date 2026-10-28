import { describe, expect, it } from "vitest";
import { outcomeOf, signForTest, WebhookHub } from "../src/bank/webhooks.js";

const SECRET = "whsec_test";
const body = (id: string, name: string, objectId: string) => JSON.stringify({ id, name, accountId: "acct_x", data: { id: objectId, status: name.split(".")[1]!.toUpperCase() } });

describe("Airwallex webhooks", () => {
  it("accepts a correctly signed event and resolves the waiting transfer", async () => {
    const hub = new WebhookHub(SECRET);
    const wait = hub.waitFor("cat_1");
    const raw = body("evt_1", "connected_account_transfer.settled", "cat_1");
    expect(hub.handle(raw, signForTest(SECRET, raw))).toBe(200);
    await expect(wait).resolves.toBe("settled");
  });

  it("remembers an event that arrives before anyone waits for it", async () => {
    const hub = new WebhookHub(SECRET);
    const raw = body("evt_2", "charge.failed", "chg_9");
    hub.handle(raw, signForTest(SECRET, raw));
    await expect(hub.waitFor("chg_9")).resolves.toBe("failed");
  });

  it("rejects a bad signature, a body changed after signing, and a stale timestamp", () => {
    const hub = new WebhookHub(SECRET);
    const raw = body("evt_3", "charge.settled", "chg_1");
    expect(hub.handle(raw, signForTest("wrong-secret", raw))).toBe(400);
    expect(hub.handle(raw.replace("chg_1", "chg_2"), signForTest(SECRET, raw))).toBe(400);
    const old = String(Date.now() - 10 * 60_000);
    expect(hub.handle(raw, signForTest(SECRET, raw, old))).toBe(400);
    expect(hub.handle(raw, {})).toBe(400);
    expect(hub.stats.rejected).toBe(4);
  });

  it("acknowledges a redelivered event without acting on it twice", () => {
    const hub = new WebhookHub(SECRET);
    const raw = body("evt_4", "charge.settled", "chg_4");
    expect(hub.handle(raw, signForTest(SECRET, raw))).toBe(200);
    expect(hub.handle(raw, signForTest(SECRET, raw))).toBe(200);
    expect(hub.stats).toEqual({ accepted: 1, rejected: 0, duplicates: 1 });
  });

  it("maps only transfer and charge events", () => {
    expect(outcomeOf("connected_account_transfer.settled")).toBe("settled");
    expect(outcomeOf("connected_account_transfer.suspended")).toBe("failed");
    expect(outcomeOf("charge.pending")).toBe("pending");
    expect(outcomeOf("payment_intent.succeeded")).toBeUndefined();
  });
});
