import { fail, ok, RATE_POLICIES, rateLimit } from '@/features/slide-vault/server';
import { configuredTranscriber, MAX_AUDIO_BYTES, type Transcriber } from '@/features/slide-vault/server/ai/speech';

// GET /speech: { available, status }: 'on', 'off' (not set up here) or 'down' (set up, but the speech
// service isn't answering, e.g. it stopped after a restart). The mic shows which.
// POST /speech (multipart/form-data): audio (WAV) -> { text } (docs/DECISIONS.md FD-24).
// The audio goes only to the configured speech service and is never stored.
type SpeechStatus = 'on' | 'off' | 'down';
const RECHECK_MS = 15000;
let lastCheck: { at: number; status: SpeechStatus } | null = null;

export async function GET() {
  let transcriber: Transcriber | null;
  try {
    transcriber = configuredTranscriber();
  } catch {
    transcriber = null;
  }
  if (!transcriber) return ok({ available: false, status: 'off' satisfies SpeechStatus });
  // Every mic on every page asks, so the answer is kept for a few seconds.
  if (!lastCheck || Date.now() - lastCheck.at > RECHECK_MS) lastCheck = { at: Date.now(), status: (await transcriber.answers()) ? 'on' : 'down' };
  return ok({ available: lastCheck.status === 'on', status: lastCheck.status });
}

export async function POST(request: Request) {
  const limited = rateLimit(request, RATE_POLICIES.speech);
  if (limited) return limited;
  let transcriber: Transcriber | null;
  try {
    transcriber = configuredTranscriber();
  } catch (e) {
    console.error('Speech is misconfigured:', (e as Error).message);
    return fail(500, 'LIBRARY_NOT_READY', 'Talking is not set up correctly on the server.');
  }
  if (!transcriber) return fail(503, 'LIBRARY_NOT_READY', 'Talking is not set up on this server. Type instead.');

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return fail(400, 'BAD_REQUEST', 'Expected multipart/form-data.');
  }
  const audio = form.get('audio');
  if (!(audio instanceof Blob) || audio.size === 0) return fail(400, 'BAD_REQUEST', 'Attach the recording as "audio".');
  if (audio.size > MAX_AUDIO_BYTES) return fail(413, 'BAD_REQUEST', 'That recording is too long. Keep it under about two minutes.');

  try {
    return ok({ text: await transcriber.transcribe(audio, 'speech.wav') });
  } catch (e) {
    console.error('Speech failed:', (e as Error).message);
    lastCheck = null; // the next check asks the service again
    return fail(503, 'LIBRARY_NOT_READY', "Couldn't hear that right now. Try again, or type instead.", true);
  }
}
