import { useEffect, useState } from "react";
import type { RunRecord, RunSummary } from "../../../src/sim/record";

export type LatestRun = { state: "loading" } | { state: "missing" } | { state: "ready"; run: RunRecord };

/** A run recorded by `npm run demo:sandbox` (or `demo -- --record`), served from web/public/runs. Defaults to the latest. */
export function useLatestRun(file = "latest.json"): LatestRun {
  const [load, setLoad] = useState<LatestRun>({ state: "loading" });
  useEffect(() => {
    let live = true;
    setLoad({ state: "loading" });
    fetch(`/runs/${file}`, { cache: "no-store" })
      .then((r) => (r.ok && r.headers.get("content-type")?.includes("json") ? r.json() : Promise.reject()))
      .then((run: RunRecord) => live && setLoad({ state: "ready", run }))
      .catch(() => live && setLoad({ state: "missing" }));
    return () => {
      live = false;
    };
  }, [file]);
  return load;
}

/** Every published sandbox run, newest first (written by the CLI and the daily GitHub Action). */
export function useRunHistory(): RunSummary[] {
  const [runs, setRuns] = useState<RunSummary[]>([]);
  useEffect(() => {
    fetch("/runs/history.json", { cache: "no-store" })
      .then((r) => (r.ok && r.headers.get("content-type")?.includes("json") ? r.json() : []))
      .then((h: RunSummary[]) => setRuns(Array.isArray(h) ? h : []))
      .catch(() => setRuns([]));
  }, []);
  return runs;
}

export const runDate = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
