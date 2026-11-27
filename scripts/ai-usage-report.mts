/**
 * Who used the AI and how much, per person (FD-91), for whoever runs the servers. Reads M Moser's database
 * when it's set up, else this computer's log (the data folder's ai-usage.jsonl).
 *
 *   npm run ai-usage            last 30 days
 *   npm run ai-usage -- 7       last 7 days
 */
const { aiUsageTotals } = await import('../features/slide-vault/server/ai/usage');
const days = Number(process.argv[2] ?? 30);
const totals = await aiUsageTotals({ days });
if (!totals.length) console.log(`No AI calls in the last ${days} days.`);
for (const t of totals) {
  const features = Object.entries(t.byFeature).map(([f, n]) => `${f} ${n}`).join(', ');
  console.log(`${t.user.padEnd(28)} ${String(t.calls).padStart(5)} calls  ${String(t.totalTokens).padStart(9)} tokens  (${t.promptTokens} in, ${t.completionTokens} out)${t.failed ? `  ${t.failed} failed` : ''}  ${features}`);
}
process.exit(0);
