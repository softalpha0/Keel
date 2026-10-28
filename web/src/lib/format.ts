/** Full dollars from cents: $26,000 */
export const money = (cents: number) =>
  (cents < 0 ? "−$" : "$") + Math.round(Math.abs(cents) / 100).toLocaleString("en-US");

const SYMBOL: Record<string, string> = { USD: "$", SGD: "S$", EUR: "€", GBP: "£", AUD: "A$", HKD: "HK$" };

/** Any currency from minor units: moneyIn(108000, "SGD") -> "S$1,080" */
export const moneyIn = (minor: number, currency = "USD") =>
  currency === "USD" ? money(minor) : (minor < 0 ? "−" : "") + (SYMBOL[currency] ?? `${currency} `) + Math.round(Math.abs(minor) / 100).toLocaleString("en-US");

/** Compact dollars for axes and tight labels: $30K, $3.7K, $1.2M */
export const moneyCompact = (cents: number) => {
  const d = Math.abs(cents) / 100;
  const sign = cents < 0 ? "−" : "";
  if (d >= 1_000_000) return `${sign}$${trim(d / 1_000_000)}M`;
  if (d >= 1_000) return `${sign}$${trim(d / 1_000)}K`;
  return `${sign}$${Math.round(d)}`;
};

const trim = (n: number) => (n >= 100 ? Math.round(n).toString() : n.toFixed(1).replace(/\.0$/, ""));

export const pct = (bps: number) => `${(bps / 100).toFixed(bps % 100 ? 1 : 0)}%`;

export const optionLabel: Record<string, string> = {
  full: "Fund in full",
  partial: "Fund partially",
  delay: "Delay",
  reallocate: "Reallocate capital",
  decline: "Decline",
};

export const borrowerSector: Record<string, string> = {
  kopi: "Coffee roaster · retail",
  nimbus: "Apparel · e-commerce",
  ledgerly: "B2B SaaS · subscriptions",
};
