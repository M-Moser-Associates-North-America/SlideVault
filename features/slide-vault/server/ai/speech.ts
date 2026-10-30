import 'server-only';

/**
 * Speech to text (docs/DECISIONS.md FD-24): talk instead of type. One setting picks the service,
 * like the AI reader (FD-17): any OpenAI-compatible /audio/transcriptions endpoint, so the same code
 * works with Whisper running on the laptop (whisper.cpp's server), a model M Moser hosts, Azure
 * OpenAI or OpenAI itself. The audio is sent only to the configured service and never stored.
 */

export type SpeechConfig =
  | { provider: 'none' }
  | { provider: 'openai-compatible'; baseUrl: string; apiKey: string | null; model: string; timeoutMs: number };

export function readSpeechConfig(env: Record<string, string | undefined> = process.env): SpeechConfig {
  const provider = env.SV_SPEECH_PROVIDER?.trim() || 'none';
  if (provider === 'none') return { provider: 'none' };
  if (provider !== 'openai-compatible') throw new Error(`Unknown SV_SPEECH_PROVIDER "${provider}". Use none or openai-compatible.`);
  const baseUrl = env.SV_SPEECH_BASE_URL?.trim().replace(/\/+$/, '');
  if (!baseUrl) throw new Error('SV_SPEECH_BASE_URL is required when SV_SPEECH_PROVIDER is openai-compatible.');
  const timeoutMs = Number(env.SV_SPEECH_TIMEOUT_MS || 30000);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 120000) throw new Error('SV_SPEECH_TIMEOUT_MS must be a whole number from 1000 to 120000.');
  return { provider, baseUrl, apiKey: env.SV_SPEECH_API_KEY?.trim() || null, model: env.SV_SPEECH_MODEL?.trim() || 'whisper-1', timeoutMs };
}

/** Longest recording accepted: about two minutes of 16 kHz mono WAV. */
export const MAX_AUDIO_BYTES = 4 * 1024 * 1024;

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export type Transcriber = {
  name: string;
  transcribe(audio: Blob, fileName: string): Promise<string>;
  /** Whether the service answers at all right now (it may be set up but stopped, e.g. after a restart) */
  answers(): Promise<boolean>;
};

const HEALTH_TIMEOUT_MS = 2000;

export function openAiCompatibleTranscriber(config: Extract<SpeechConfig, { provider: 'openai-compatible' }>, fetchFn: FetchLike = fetch): Transcriber {
  return {
    name: `openai-compatible:${config.model}`,
    async transcribe(audio, fileName) {
      const form = new FormData();
      form.append('file', audio, fileName);
      form.append('model', config.model);
      form.append('response_format', 'json');
      const res = await fetchFn(`${config.baseUrl}/audio/transcriptions`, {
        method: 'POST',
        headers: config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {},
        body: form,
        signal: AbortSignal.timeout(config.timeoutMs),
      });
      if (!res.ok) throw new Error(`Speech service request failed (${res.status})`);
      const body = (await res.json()) as { text?: unknown };
      return typeof body.text === 'string' ? body.text.replace(/\s+/g, ' ').trim() : '';
    },
    // Any reply counts, even a 404 or 401: hosted services and Whisper's own server answer /models
    // differently, but only a service that is down gives no reply at all.
    async answers() {
      try {
        await fetchFn(`${config.baseUrl}/models`, { method: 'GET', headers: config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}, signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS) });
        return true;
      } catch {
        return false;
      }
    },
  };
}

export function configuredTranscriber(env: Record<string, string | undefined> = process.env): Transcriber | null {
  const config = readSpeechConfig(env);
  return config.provider === 'none' ? null : openAiCompatibleTranscriber(config);
}
