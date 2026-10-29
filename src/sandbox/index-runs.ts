import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { summarize, type RunRecord, type RunSummary } from "../sim/record.js";

/**
 * npm run runs:index : rebuild web/public/runs/history.json from every Airwallex sandbox run kept in evidence/.
 * The CLI keeps the index up to date on each run; this is for seeding it from earlier runs.
 */
const dir = "evidence";
const files = existsSync(dir) ? readdirSync(dir).filter((f) => /^airwallex-sandbox-.*\.json$/.test(f)) : [];
mkdirSync("web/public/runs", { recursive: true });
const history: RunSummary[] = [];
for (const f of files) {
  const run = JSON.parse(readFileSync(`${dir}/${f}`, "utf8")) as RunRecord;
  if (run.source !== "airwallex-sandbox") continue;
  const name = f.replace(/^airwallex-sandbox-/, "");
  copyFileSync(`${dir}/${f}`, `web/public/runs/${name}`);
  history.push(summarize(run, name));
}
history.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
writeFileSync("web/public/runs/history.json", JSON.stringify(history.slice(0, 90), null, 2));
console.log(`Indexed ${history.length} sandbox run(s) into web/public/runs/history.json`);
for (const h of history) console.log(`  ${h.startedAt}  ${h.floorHeldEveryWeek && h.reconciledEveryWeek ? "✓" : "✗"}  ${h.byClaude}/${h.decisions} by Claude  ${h.file}`);
