import Anthropic from "@anthropic-ai/sdk";

/**
 * POST /api/ask : "Ask Keel" on the credit desk and the sandbox run page.
 * The browser sends the question plus a compact copy of the run it is looking at; Claude answers
 * from that data only. Runs server-side so ANTHROPIC_API_KEY never reaches the browser.
 */

const SYSTEM = `You are Ask Keel, the assistant on Keel's credit desk. Keel is a revenue-based lending agent for a platform on Airwallex: it collects a share of each borrower's weekly revenue, rates borrower health (healthy, watch, stressed), and sizes advances so platform cash never drops below a reserve floor. Policy code builds the options; a model chooses among feasible ones; only the executor moves money.

Answer the operator's question using only the portfolio data provided. Cite the week, the borrower and the amounts that support your answer. If the data does not contain the answer, say so plainly instead of guessing. Write 2 to 5 sentences of plain prose, no headings or bullet lists. Amounts in the data are in minor units (cents) unless a field says otherwise; present them as dollars (or the borrower's currency). You explain decisions; you cannot change them or move money.`;

const MAX_QUESTION = 500;
const MAX_CONTEXT = 80_000;
const WINDOW_MS = 10 * 60_000;
const MAX_PER_WINDOW = 12;
const hits = new Map<string, number[]>();

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

function limited(ip: string): boolean {
  // Best-effort per-instance limit: this endpoint spends the owner's API credit.
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > MAX_PER_WINDOW;
}

export async function POST(request: Request): Promise<Response> {
  if (!process.env.ANTHROPIC_API_KEY) return json(503, { error: "not-configured" });

  let body: { question?: unknown; context?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json(400, { error: "invalid JSON" });
  }
  const question = typeof body.question === "string" ? body.question.trim() : "";
  if (!question || question.length > MAX_QUESTION) return json(400, { error: `question must be 1-${MAX_QUESTION} characters` });
  const context = JSON.stringify(body.context ?? {});
  if (context.length > MAX_CONTEXT) return json(413, { error: "context too large" });

  const ip = (request.headers.get("x-forwarded-for") ?? "local").split(",")[0]!.trim();
  if (limited(ip)) return json(429, { error: "Too many questions. Try again in a few minutes." });

  const client = new Anthropic();
  try {
    const res = await client.beta.messages.create({
      model: "claude-opus-5-5",
      max_tokens: 4000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      // A desk question needs a quick, grounded answer, not deep deliberation.
      output_config: { effort: "low" },
      system: SYSTEM,
      messages: [{ role: "user", content: `Portfolio data:\n\`\`\`json\n${context}\n\`\`\`\n\nQuestion: ${question}` }],
    } as Anthropic.Beta.Messages.MessageCreateParamsNonStreaming);

    if (res.stop_reason === "refusal") return json(200, { answer: "I can't answer that one. Try asking about a specific decision, borrower or week.", by: "claude" });
    const answer = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("").trim();
    if (!answer) return json(502, { error: "empty answer" });
    return json(200, { answer, by: "claude", model: res.model });
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) return json(429, { error: "Claude is busy. Try again in a moment." });
    if (err instanceof Anthropic.APIError) return json(502, { error: `Claude API error (${err.status})` });
    return json(502, { error: "Could not reach Claude" });
  }
}

export function GET(): Response {
  return json(405, { error: "POST a question" });
}
