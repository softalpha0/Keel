import type { AskContext } from "../../../src/ask/context";
import { offlineAnswer } from "../../../src/ask/context";

export { compactDecisions, compactEvents, offlineAnswer, type AskContext } from "../../../src/ask/context";

export interface AskAnswer {
  answer: string;
  by: "claude" | "log";
}

/** Asks Claude through /api/ask; if Claude isn't configured or reachable, answers from the decision log. */
export async function askKeel(question: string, context: AskContext): Promise<AskAnswer> {
  try {
    const res = await fetch("/api/ask", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question, context }) });
    const body = (await res.json().catch(() => ({}))) as { answer?: string; error?: string };
    if (res.ok && body.answer) return { answer: body.answer, by: "claude" };
    if (res.status === 429 && body.error) return { answer: body.error, by: "log" };
  } catch {
    /* offline or no API on this host: fall through */
  }
  return { answer: offlineAnswer(question, context), by: "log" };
}

