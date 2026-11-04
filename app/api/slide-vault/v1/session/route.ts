import { ok } from '@/features/slide-vault/server';
import { CONTRACT_VERSION } from '@/features/slide-vault/contracts/runtime';
import { configuredReader } from '@/features/slide-vault/server/services/library-smart-search';

// GET /session: effective capabilities for the caller.
// Prototype: no sign-in yet (decision FD-01), so the single local user gets the read/export set.
// aiAvailable says whether the server has an AI reader set up, so Home can offer "Deeper AI search"
// before the first search (FD-79). A misconfigured reader just reads as "not available" here; search reports it.
export async function GET() {
  let aiAvailable = false;
  try {
    aiAvailable = configuredReader() !== null;
  } catch {
    aiAvailable = false;
  }
  return ok({ contractVersion: CONTRACT_VERSION, capabilities: ['library.read', 'collection.write', 'export.create'], aiAvailable });
}
