import 'server-only';
import { openAiCompatibleReader } from './openai-compatible';
import type { PlanContext, SearchPlan } from './search-plan';

/**
 * Provider-neutral request reader (docs/DECISIONS.md FD-17). A reader only turns a typed request
 * into a SearchPlan. Retrieval, authorization and "why it fits" never depend on it, so swapping
 * the provider is a server setting with no UI or database change.
 */
export type PlanReader = {
  /** Short provider label for logs, e.g. "openai-compatible:qwen3:8b". Never includes a key. */
  name: string;
  /** Returns a cleaned plan, or throws (smartSearch falls back to the rules-only stand-in). */
  read(query: string, ctx: PlanContext): Promise<SearchPlan>;
};

export type AiConfig =
  | { provider: 'none' }
  | { provider: 'openai-compatible'; baseUrl: string; apiKey: string | null; model: string; timeoutMs: number };

/**
 * SV_AI_PROVIDER picks the reader:
 *  - none (default): rules only, nothing leaves the server
 *  - openai-compatible: any /chat/completions endpoint, e.g. a local Ollama running Qwen3
 *    (SV_AI_BASE_URL=http://localhost:11434/v1) or OpenAI (https://api.openai.com/v1)
 * A provider that is named but not fully configured is an error, never a silent fallback.
 */
export function readAiConfig(env: Record<string, string | undefined> = process.env): AiConfig {
  const provider = env.SV_AI_PROVIDER?.trim() || 'none';
  if (provider === 'none') return { provider: 'none' };
  if (provider !== 'openai-compatible') throw new Error(`Unknown SV_AI_PROVIDER "${provider}". Use none or openai-compatible.`);
  const baseUrl = env.SV_AI_BASE_URL?.trim().replace(/\/+$/, '');
  const model = env.SV_AI_MODEL?.trim();
  if (!baseUrl || !model) throw new Error('SV_AI_PROVIDER=openai-compatible needs SV_AI_BASE_URL and SV_AI_MODEL. See env.example.');
  const timeoutMs = Number(env.SV_AI_TIMEOUT_MS || 15000);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 60000) throw new Error('SV_AI_TIMEOUT_MS must be a whole number from 1000 to 60000.');
  return { provider, baseUrl, apiKey: env.SV_AI_API_KEY?.trim() || null, model, timeoutMs };
}

/** The configured reader, or null for rules only. */
export function readerFromConfig(config: AiConfig = readAiConfig()): PlanReader | null {
  return config.provider === 'none' ? null : openAiCompatibleReader(config);
}
