import type { AdvanceOption, OptionKind } from "../../../src/domain";
import { money, optionLabel } from "../lib/format";
import { Check, Cross } from "./Status";

interface Props {
  options: AdvanceOption[];
  chosen?: OptionKind;
  floor: number;
  compact?: boolean;
}

/**
 * Every option the policy engine considered, scored on the same scale.
 * Options that would breach the floor are shown, but can never be chosen.
 */
export function OptionBars({ options, chosen, floor, compact }: Props) {
  const max = Math.max(1, ...options.map((o) => o.score));
  return (
    <div className={`options${compact ? " options-compact" : ""}`} role="table" aria-label="Options considered">
      <div className="options-head" role="row">
        <span role="columnheader">Option</span>
        <span role="columnheader">Score</span>
        <span role="columnheader" className="options-num">Amount</span>
        <span role="columnheader" className="options-num">Cash after</span>
      </div>
      {options.map((o) => {
        const isChosen = o.kind === chosen && o.feasible;
        const w = Math.max(0, o.score) / max;
        return (
          <div key={o.kind} role="row" className={`options-row${isChosen ? " is-chosen" : ""}${o.feasible ? "" : " is-blocked"}`}>
            <span role="cell" className="options-label">
              {optionLabel[o.kind]}
              {isChosen && (
                <span className="pill pill-accent">
                  <Check size={12} /> Chosen
                </span>
              )}
              {o.breachesFloor && (
                <span className="pill pill-critical">
                  <Cross size={12} /> Breaches floor
                </span>
              )}
            </span>
            <span role="cell" className="options-bar">
              <span className="bar-track">
                <span className="bar-fill" style={{ width: `${w * 100}%` }} />
              </span>
              <span className="bar-value num">{money(o.score)}</span>
            </span>
            <span role="cell" className="options-num num">{o.kind === "decline" ? "—" : money(o.amount)}</span>
            <span role="cell" className={`options-num num${o.projectedBalanceAfter < floor ? " is-below" : ""}`}>{money(o.projectedBalanceAfter)}</span>
          </div>
        );
      })}
    </div>
  );
}
