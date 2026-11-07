/**
 * Fifty people searching at once (FD-94; Schiffon, 5 Nov: "put a ton of people on this system… it won't break").
 * Each pretend person signs in under their own name and runs a few real searches from the client meetings,
 * all at the same moment. Prints how many got results, how many were told to wait (429), errors, and how long
 * searches took. Needs the app running.
 *
 *   npm run load-test -- http://localhost:3000 50 4        url, people, searches each
 */
const [base = 'http://localhost:3000', peopleArg = '50', eachArg = '4'] = process.argv.slice(2);
const people = Number(peopleArg);
const each = Number(eachArg);
const SEARCHES = ['firm overview', 'case studies', 'map with all our offices', 'most recent hospitality deck', 'org chart', 'resumes', 'sustainability services', 'which slides show how we manage a phased move for a bank?', '2026', 'QA/QC methodology process'];

type Outcome = { status: number; ms: number; busy: boolean; ai: boolean };
async function one(user: string, q: string, read: boolean): Promise<Outcome> {
  const t = performance.now();
  try {
    const res = await fetch(`${base}/api/slide-vault/v1/smart-search?q=${encodeURIComponent(q)}&limit=100${read ? '&read=1' : ''}`, { headers: { 'x-slidevault-user': user } });
    const body = res.ok ? ((await res.json()) as { data?: { readerNote?: string | null; reader?: string } }) : null;
    return { status: res.status, ms: performance.now() - t, busy: /busy/i.test(body?.data?.readerNote ?? ''), ai: body?.data?.reader === 'model' };
  } catch {
    return { status: 0, ms: performance.now() - t, busy: false, ai: false };
  }
}

const pct = (xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b); return s.length ? Math.round(s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]) : 0; };
console.log(`${people} people x ${each} searches against ${base}, all at once...`);
const started = performance.now();
const all = (await Promise.all(Array.from({ length: people }, (_, i) => (async () => {
  const out: Outcome[] = [];
  for (let n = 0; n < each; n++) out.push(await one(`load-person-${i}`, SEARCHES[(i + n) % SEARCHES.length], true));
  return out;
})()))).flat();
const wall = Math.round(performance.now() - started);
const ok = all.filter((o) => o.status === 200);
const ms = ok.map((o) => o.ms);
const summary = {
  searches: all.length,
  ok: ok.length,
  'told to wait (429)': all.filter((o) => o.status === 429).length,
  'server errors (5xx)': all.filter((o) => o.status >= 500).length,
  'no answer': all.filter((o) => o.status === 0).length,
  'read by AI': ok.filter((o) => o.ai).length,
  'AI busy, quick results': ok.filter((o) => o.busy).length,
  'median ms': pct(ms, 50),
  'p95 ms': pct(ms, 95),
  'slowest ms': pct(ms, 100),
  'total seconds': Math.round(wall / 100) / 10,
};
console.table(summary);
process.exit(summary['server errors (5xx)'] + summary['no answer'] > 0 ? 1 : 0);
