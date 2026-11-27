import { fail, ok } from '@/features/slide-vault/server';
import { aiUsageTotals } from '@/features/slide-vault/server/ai/usage';
import { withUser } from '@/features/slide-vault/server/user-route';

// GET /me/ai-usage?days=30: the signed-in person's own AI use, calls and tokens by feature (FD-91).
// Everyone's totals are for whoever runs the servers: npm run ai-usage (scripts/ai-usage-report.mts).
export async function GET(request: Request) {
  return withUser(request, async (user) => {
    const days = Number(new URL(request.url).searchParams.get('days') ?? 30);
    if (!Number.isInteger(days) || days < 1 || days > 365) return fail(400, 'BAD_REQUEST', 'days must be a whole number from 1 to 365.');
    const [mine] = await aiUsageTotals({ days, user });
    return ok({ days, usage: mine ?? { user, calls: 0, failed: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, byFeature: {} } });
  });
}
