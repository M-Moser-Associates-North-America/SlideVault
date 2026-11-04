import { createHash } from 'node:crypto';

/**
 * Meaning fingerprints (embeddings) for meaning search (docs/DECISIONS.md FD-55). Provider-neutral
 * like the AI reader (FD-17): any OpenAI-style /embeddings endpoint, set by three settings:
 *
 *   SV_EMBED_BASE_URL=http://localhost:11434/v1   (a local Ollama; or https://api.openai.com/v1)
 *   SV_EMBED_MODEL=nomic-embed-text               (or text-embedding-3-small, ...)
 *   SV_EMBED_API_KEY=                             (only for hosted providers)
 *
 * Without SV_EMBED_MODEL meaning search is simply off and keyword search works as before. Nothing
 * here keeps text: slides are read once, and search sends only the typed words. No 'server-only'
 * marker, so scripts can use it too.
 */
export type EmbedConfig = { baseUrl: string; model: string; apiKey: string | null; timeoutMs: number };

export function readEmbedConfig(env: Record<string, string | undefined> = process.env): EmbedConfig | null {
  const model = env.SV_EMBED_MODEL?.trim();
  if (!model) return null;
  const baseUrl = (env.SV_EMBED_BASE_URL?.trim() || 'http://localhost:11434/v1').replace(/\/+$/, '');
  const timeoutMs = Number(env.SV_EMBED_TIMEOUT_MS || 20000);
  return { baseUrl, model, apiKey: env.SV_EMBED_API_KEY?.trim() || null, timeoutMs: Number.isFinite(timeoutMs) ? timeoutMs : 20000 };
}

/** nomic-embed-text reads better with a word saying whether the text is a slide or a search. */
const prefix = (model: string, kind: 'document' | 'query') => (/nomic/i.test(model) ? (kind === 'document' ? 'search_document: ' : 'search_query: ') : '');

export async function embed(config: EmbedConfig, texts: string[], kind: 'document' | 'query'): Promise<number[][]> {
  if (!texts.length) return [];
  const res = await fetch(`${config.baseUrl}/embeddings`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}) },
    body: JSON.stringify({ model: config.model, input: texts.map((t) => prefix(config.model, kind) + t) }),
    signal: AbortSignal.timeout(config.timeoutMs),
  });
  if (!res.ok) throw new Error(`The embedding model answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const body = (await res.json()) as { data?: { embedding: number[]; index?: number }[] };
  const data = [...(body.data ?? [])].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  if (data.length !== texts.length || data.some((d) => !Array.isArray(d.embedding) || !d.embedding.length)) throw new Error('The embedding model returned an unexpected answer.');
  return data.map((d) => d.embedding);
}

/** pgvector's text form: [0.1,0.2,...] */
export const toVectorLiteral = (v: number[]) => `[${v.map((x) => (Number.isFinite(x) ? x : 0)).join(',')}]`;

/** What a slide's fingerprint is made from: its deck, words and story tags, cut to a size small models read whole. */
export type EmbedSource = {
  client: string | null; deckTitle: string; title: string | null; text: string | null;
  role?: string | null; themes?: string[] | null; sectors?: string[] | null; projects?: string[] | null; shows?: string | null; convinces?: string | null;
};
export function slideEmbedText(s: EmbedSource): string {
  const parts = [
    s.client && `Client: ${s.client}.`,
    s.title && `Slide: ${s.title}.`,
    s.role && `Part of the story: ${s.role}.`,
    s.themes?.length && `Themes: ${s.themes.join(', ')}.`,
    s.sectors?.length && `Sectors: ${s.sectors.join(', ')}.`,
    s.projects?.length && `Projects: ${s.projects.join(', ')}.`,
    s.shows && `Shows: ${s.shows}`,
    s.convinces && `Convinces: ${s.convinces}`,
    s.text?.replace(/\s+/g, ' ').trim(),
  ].filter(Boolean) as string[];
  return parts.join(' ').slice(0, 1500) || s.deckTitle;
}

export const sourceHash = (text: string, model: string) => createHash('sha256').update(`${model}\n${text}`).digest('hex').slice(0, 32);
