import { describe, expect, it } from "vitest";
import type { Advisor } from "../src/agent/advisor.js";
import { demoScenario } from "../src/sim/scenario.js";
import { runScenario } from "../src/sim/run.js";

describe("demo scenario end to end", () => {
  it("holds the floor and reconciles every week", async () => {
    const { reports } = await runScenario(demoScenario());
    for (const r of reports) {
      expect(r.floorHeld).toBe(true);
      expect(r.reconciled).toBe(true);
    }
  });

  it("solves the third advance without breaching the floor, then freezes the stressed borrower", async () => {
    const { ledger } = await runScenario(demoScenario());
    const third = ledger.decisions.find((d) => d.type === "advance-request" && d.borrowerId === "nimbus" && d.week === 5)!;
    expect(third.options?.find((o) => o.kind === "full")?.breachesFloor).toBe(true);
    expect(third.chosen).toBe("reallocate");
    const later = ledger.decisions.find((d) => d.type === "advance-request" && d.borrowerId === "nimbus" && d.week === 8)!;
    expect(later.chosen).toBe("decline");
  });

  it("ignores an advisor that picks an option policy rejected", async () => {
    const rogue: Advisor = { decide: async () => ({ kind: "full", memo: "YOLO", decidedBy: "claude" }) };
    const { reports, ledger } = await runScenario(demoScenario(), { advisor: rogue });
    expect(reports.every((r) => r.floorHeld)).toBe(true);
    const third = ledger.decisions.find((d) => d.borrowerId === "nimbus" && d.week === 5)!;
    expect(third.chosen).not.toBe("full");
  });
});
