import { describe, expect, it } from "vitest";
import { backtest } from "../src/backtest/backtest.js";
import { syntheticHistory } from "../src/backtest/history.js";

describe("backtest against merchant history", () => {
  const r = backtest();

  it("is deterministic", () => {
    expect(backtest().keel.lent).toBe(r.keel.lent);
    expect(syntheticHistory(300, 112, 11)[0]!.sales).toEqual(syntheticHistory(300, 112, 11)[0]!.sales);
  });

  it("loses far less than lending without health checks, and earns a positive return", () => {
    expect(r.keel.lossRate).toBeLessThan(r.naive.lossRate / 3);
    expect(r.keel.netReturn).toBeGreaterThan(0);
    expect(r.naive.netReturn).toBeLessThan(0);
  });

  it("loses nothing on steady and growing merchants", () => {
    expect(r.keel.byArchetype.steady.lossRate).toBe(0);
    expect(r.keel.byArchetype.growing.lossRate).toBe(0);
  });

  it("catches the refund spiral through the refund signal", () => {
    expect(r.keel.byArchetype.refunds.lossRate).toBeLessThan(0.05);
    expect(r.naive.byArchetype.refunds.lossRate).toBeGreaterThan(0.3);
  });

  it("follows the platform's rules: a smaller advance size lends less", () => {
    expect(backtest({ policy: { advanceMultipleWeeks: 2 } }).keel.lent).toBeLessThan(r.keel.lent);
  });
});
