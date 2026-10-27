import { useEffect, useState } from "react";
import type { RunRecord } from "../../../src/sim/record";

export type LatestRun = { state: "loading" } | { state: "missing" } | { state: "ready"; run: RunRecord };

/** The run recorded by `npm run demo:sandbox` (or `demo -- --record`), served from web/public/runs. */
export function useLatestRun(): LatestRun {
  const [load, setLoad] = useState<LatestRun>({ state: "loading" });
  useEffect(() => {
    let live = true;
    fetch("/runs/latest.json", { cache: "no-store" })
      .then((r) => (r.ok && r.headers.get("content-type")?.includes("json") ? r.json() : Promise.reject()))
      .then((run: RunRecord) => live && setLoad({ state: "ready", run }))
      .catch(() => live && setLoad({ state: "missing" }));
    return () => {
      live = false;
    };
  }, []);
  return load;
}

export const runDate = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
