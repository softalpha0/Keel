import { defaultParams, type ScenarioParams } from "../../../src/sim/scenario";

/**
 * The platform's saved settings and the requests merchants sent from the portal. Kept in this
 * browser only (a demo stand-in for a real database), so the desk and the portal share them.
 */
const PARAMS_KEY = "keel-desk-params";
const REQUESTS_KEY = "keel-portal-requests";

export type PortalRequest = ScenarioParams["portalRequests"][number] & { sentAt: string };

const read = <T,>(key: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
};

const write = (key: string, value: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage blocked: settings just won't persist.
  }
};

export function loadPortalRequests(): PortalRequest[] {
  const list = read<PortalRequest[]>(REQUESTS_KEY, []);
  return Array.isArray(list) ? list.filter((r) => r && typeof r.amountDollars === "number" && typeof r.borrowerId === "string") : [];
}

export function addPortalRequest(r: Omit<PortalRequest, "sentAt">) {
  const list = [...loadPortalRequests(), { ...r, sentAt: new Date().toISOString() }].slice(-6);
  write(REQUESTS_KEY, list);
  return list;
}

export function clearPortalRequests() {
  write(REQUESTS_KEY, []);
}

/** Desk settings, with the portal's requests folded in so both pages run the same scenario. */
export function loadParams(): ScenarioParams {
  const saved = read<Partial<ScenarioParams>>(PARAMS_KEY, {});
  const known = Object.fromEntries(Object.entries(saved).filter(([k]) => k in defaultParams && k !== "portalRequests"));
  return { ...defaultParams, ...known, portalRequests: loadPortalRequests().map(({ borrowerId, amountDollars, week }) => ({ borrowerId, amountDollars, week })) };
}

export function saveParams(p: ScenarioParams) {
  const { portalRequests: _ignored, ...rest } = p;
  write(PARAMS_KEY, rest);
}
