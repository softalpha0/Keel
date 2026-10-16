import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { fmt } from "../domain.js";
import { describe, RulesAdvisor, type Advisor, type AdvisorDecision, type AdvisorInput } from "./advisor.js";

const Choice = z.object({
  kind: z.enum(["full", "partial", "delay", "reallocate", "decline"]),
  memo: z.string(),
});

const CHOICE_SCHEMA = {
  type: "object",
  properties: {
    kind: { type: "string", enum: ["full", "partial", "delay", "reallocate", "decline"] },
    memo: { type: "string", description: "3-5 sentence credit memo a lender's risk committee can read." },
  },
  required: ["kind", "memo"],
  additionalProperties: false,
} as const;

const SYSTEM = `You are the credit officer for a revenue-based lending platform.
Fixed policy code has already computed every option that keeps platform cash above the reserve floor, with scores.
Pick one of the listed options and write a short credit memo explaining the choice to a human risk committee.
You may prefer a lower-scored option when the borrower's signals justify it; say why. Never propose an amount or option that is not listed.`;

/**
 * Claude reads the signals and the policy-approved options, picks one and writes the memo.
 * The orchestrator re-checks the pick against the feasible list, so a bad answer cannot move money.
 */
export class ClaudeAdvisor implements Advisor {
  private client = new Anthropic();
  private fallback = new RulesAdvisor();

  async decide(input: AdvisorInput): Promise<AdvisorDecision> {
    const prompt = [
      `Week ${input.week}. ${input.borrower.name} (${input.borrower.id}) requests ${fmt(input.requested)}.`,
      `Health: tier ${input.signals.tier}; avg weekly revenue ${fmt(input.signals.avgWeeklyRevenue)}; trend ${(input.signals.trendPct * 100).toFixed(1)}%; volatility ${input.signals.volatility.toFixed(2)}; ${input.signals.reasons.join("; ")}.`,
      `Portfolio: ${input.portfolioSummary}`,
      `Policy-approved options (best score first):`,
      ...input.feasible.map((o) => `- ${describe(o)}. ${o.rationale.at(-1)}`),
    ].join("\n");

    try {
      const res = await this.client.beta.messages.create({
        model: "claude-opus-5-5",
        max_tokens: 4000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        output_config: { effort: "medium", format: { type: "json_schema", schema: CHOICE_SCHEMA } },
        system: SYSTEM,
        messages: [{ role: "user", content: prompt }],
      } as Anthropic.Beta.Messages.MessageCreateParamsNonStreaming);

      if (res.stop_reason === "refusal") throw new Error("model declined");
      const text = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
      const parsed = Choice.parse(JSON.parse(text));
      if (!input.feasible.some((o) => o.kind === parsed.kind)) throw new Error(`model picked unlisted option ${parsed.kind}`);
      return { kind: parsed.kind, memo: parsed.memo, decidedBy: "claude" };
    } catch (err) {
      const d = await this.fallback.decide(input);
      return { ...d, memo: `${d.memo} (Claude unavailable: ${err instanceof Error ? err.message : String(err)})` };
    }
  }
}
