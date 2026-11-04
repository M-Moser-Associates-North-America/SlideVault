import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { readSupabaseConfig } from './config';

/**
 * Server-only Supabase client using the service role key, which bypasses Row Level
 * Security (docs/SECURITY_AND_OPERATIONS.md). Authorization for every query using this
 * client must happen in application code -- RLS is deny-by-default until the access
 * model (D-02) is resolved, and nothing here is ever allowed to reach the browser.
 */
let client: SupabaseClient | null = null;

export function supabaseAdmin(): SupabaseClient {
  if (client) return client;
  const { url, serviceRoleKey } = readSupabaseConfig();
  client = createClient(url, serviceRoleKey, { auth: { persistSession: false } });
  return client;
}
