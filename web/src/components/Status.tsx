import type { Tier } from "../../../src/domain";

const LABEL: Record<Tier | "new", string> = {
  healthy: "Healthy",
  watch: "Watch",
  stressed: "Stressed",
  new: "No history",
};

/** Status is never color alone: each tier has its own shape and a label. */
export function TierIcon({ tier }: { tier: Tier | "new" }) {
  if (tier === "healthy")
    return (
      <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
        <circle cx="6" cy="6" r="5" fill="currentColor" opacity="0.18" />
        <path d="M3.6 6.2l1.6 1.6 3.2-3.4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  if (tier === "watch")
    return (
      <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
        <path d="M6 1.2l5 9H1z" fill="currentColor" opacity="0.2" />
        <path d="M6 4.6v2.6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        <circle cx="6" cy="8.8" r="0.9" fill="currentColor" />
      </svg>
    );
  if (tier === "stressed")
    return (
      <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
        <path d="M4 1h4l3 3v4l-3 3H4L1 8V4z" fill="currentColor" opacity="0.2" />
        <path d="M4.3 4.3l3.4 3.4M7.7 4.3L4.3 7.7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    );
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
      <circle cx="6" cy="6" r="4.2" fill="none" stroke="currentColor" strokeWidth="1.4" strokeDasharray="2 2" />
    </svg>
  );
}

export function TierBadge({ tier }: { tier: Tier | "new" }) {
  return (
    <span className={`tier tier-${tier}`}>
      <TierIcon tier={tier} />
      {LABEL[tier]}
    </span>
  );
}

export function Check({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Cross({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
      <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
