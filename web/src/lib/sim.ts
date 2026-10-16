import { useCallback, useEffect, useRef, useState } from "react";
import type { AdvanceOption, Advance, Tier } from "../../../src/domain";
import type { Approver, LendingAgent, WeekReport } from "../../../src/agent/lending-agent";
import type { DecisionRecord, Ledger } from "../../../src/ledger";
import { demoScenario, type ScenarioParams } from "../../../src/sim/scenario";
import { createSimulation, runScenario, type Simulation } from "../../../src/sim/run";

export const TOTAL_WEEKS = 10;

export interface BorrowerSnap {
  id: string;
  name: string;
  tier: Tier | "new";
  reasons: string[];
  revenue: number[];
  outstanding: number;
  holdbackBps: number;
}

export interface WeekSnap {
  week: number;
  cash: number;
  floor: number;
  committed: number;
  outstanding: number;
  feesBooked: number;
  collectedToDate: number;
  reconciled: boolean;
  floorHeld: boolean;
  borrowers: BorrowerSnap[];
}

/** Freezes the agent's state at the end of a week so the UI can scrub through history. */
export function snapshot(agent: LendingAgent, r: WeekReport): WeekSnap {
  const l = agent.ledger;
  return {
    week: r.week,
    cash: r.platformBalance,
    floor: agent.cfg.reserveFloor,
    committed: l.commitments.reduce((s, c) => s + c.amount, 0),
    outstanding: l.advances.reduce((s, a) => s + a.outstanding, 0),
    feesBooked: l.advances.reduce((s, a) => s + a.fee, 0),
    collectedToDate: l.receipts.filter((x) => x.kind === "collect" && x.status === "settled").reduce((s, x) => s + x.amount, 0),
    reconciled: r.reconciled,
    floorHeld: r.floorHeld,
    borrowers: [...agent.borrowers.values()].map((b) => {
      const sig = l.signals.get(b.id);
      return {
        id: b.id,
        name: b.name,
        tier: sig?.tier ?? "new",
        reasons: sig?.reasons ?? [],
        revenue: [...(l.revenue.get(b.id) ?? [])],
        outstanding: l.outstanding(b.id),
        holdbackBps: b.holdbackBps,
      };
    }),
  };
}

export interface RunResult {
  snaps: WeekSnap[];
  decisions: DecisionRecord[];
  events: Ledger["events"];
  advances: Advance[];
  fundSize: number;
}

/** Runs the whole scenario with auto-approval. Used by the landing page. */
export async function runToEnd(params: Partial<ScenarioParams> = {}): Promise<RunResult> {
  const snaps: WeekSnap[] = [];
  const s = demoScenario(params);
  const { ledger } = await runScenario(s, { onWeek: (r, agent) => snaps.push(snapshot(agent, r)) });
  return { snaps, decisions: ledger.decisions, events: ledger.events, advances: ledger.advances, fundSize: s.fundSize };
}

export function useDemoRun(params: Partial<ScenarioParams> = {}) {
  const [run, setRun] = useState<RunResult | null>(null);
  const key = JSON.stringify(params);
  useEffect(() => {
    let live = true;
    void runToEnd(params).then((r) => live && setRun(r));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return run;
}

export interface PendingApproval {
  record: DecisionRecord;
  option: AdvanceOption;
  resolve: (approved: boolean) => void;
}

/**
 * Drives a live simulation for the console: step, play, reset, and pause for a human
 * whenever policy requires approval.
 */
export function useLiveSimulation(params: ScenarioParams, autoApprove: boolean) {
  const [snaps, setSnaps] = useState<WeekSnap[]>([]);
  const [decisions, setDecisions] = useState<DecisionRecord[]>([]);
  const [events, setEvents] = useState<Ledger["events"]>([]);
  const [pending, setPending] = useState<PendingApproval | null>(null);
  const [playing, setPlaying] = useState(false);
  const [busy, setBusy] = useState(false);
  const [initial, setInitial] = useState<WeekSnap | null>(null);
  const sim = useRef<Simulation | null>(null);
  const autoRef = useRef(autoApprove);
  autoRef.current = autoApprove;
  const generation = useRef(0);

  const approver: Approver = {
    approve: (record, option) =>
      autoRef.current
        ? Promise.resolve({ approved: true, by: "auto-approve" })
        : new Promise((res) =>
            setPending({
              record,
              option,
              resolve: (approved) => {
                setPending(null);
                res({ approved, by: "you" });
              },
            }),
          ),
  };

  const reset = useCallback(async () => {
    const gen = ++generation.current;
    setPlaying(false);
    setPending(null);
    const s = demoScenario(params);
    const created = await createSimulation(s, { approver });
    if (gen !== generation.current) return;
    sim.current = created;
    setSnaps([]);
    setDecisions([]);
    setEvents([]);
    setInitial({
      week: 0,
      cash: s.fundSize,
      floor: created.agent.cfg.reserveFloor,
      committed: created.ledger.commitments.reduce((a, c) => a + c.amount, 0),
      outstanding: 0,
      feesBooked: 0,
      collectedToDate: 0,
      reconciled: true,
      floorHeld: true,
      borrowers: s.borrowers.map((b) => ({ id: b.id, name: b.name, tier: "new", reasons: [], revenue: [], outstanding: 0, holdbackBps: b.holdbackBps })),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(params)]);

  useEffect(() => {
    void reset();
  }, [reset]);

  const step = useCallback(async () => {
    const s = sim.current;
    if (!s || s.done || busy) return;
    const gen = generation.current;
    setBusy(true);
    try {
      const r = await s.step();
      if (!r || gen !== generation.current) return;
      setSnaps((prev) => [...prev, snapshot(s.agent, r)]);
      setDecisions([...s.ledger.decisions]);
      setEvents([...s.ledger.events]);
      if (s.done) setPlaying(false);
    } finally {
      if (gen === generation.current) setBusy(false);
    }
  }, [busy]);

  useEffect(() => {
    if (!playing || busy || pending) return;
    const t = setTimeout(() => void step(), 850);
    return () => clearTimeout(t);
  }, [playing, busy, pending, step, snaps.length]);

  const latest = snaps.at(-1) ?? initial;
  return {
    snaps,
    latest,
    openingCash: initial?.cash ?? 0,
    decisions,
    events,
    pending,
    playing,
    busy,
    done: snaps.length >= TOTAL_WEEKS,
    play: () => setPlaying(true),
    pause: () => setPlaying(false),
    step,
    reset,
  };
}
