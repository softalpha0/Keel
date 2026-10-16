/** Loads .env if present (Node 20.12+). Real environment variables still win. */
export function loadEnv() {
  try {
    process.loadEnvFile(".env");
  } catch {
    /* no .env file: rely on the shell environment */
  }
}

/** AIRWALLEX_BORROWER_ACCOUNTS=kopi=acct_...,nimbus=acct_...,ledgerly=acct_... */
export function borrowerAccountsFromEnv(): Record<string, string> {
  const raw = process.env.AIRWALLEX_BORROWER_ACCOUNTS ?? "";
  return Object.fromEntries(
    raw
      .split(",")
      .map((p) => p.trim())
      .filter((p) => /=acct_/.test(p))
      .map((p) => p.split("=") as [string, string]),
  );
}
