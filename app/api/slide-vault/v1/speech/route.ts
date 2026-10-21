import { fail, ok, RATE_POLICIES, rateLimit } from '@/features/slide-vault/server';
import { configuredTranscriber, MAX_AUDIO_BYTES, type Transcriber } from '@/features/slide-vault/server/ai/speech';

// GET /speech: whether talking is available here (the mic button hides itself when it isn't).
// POST /speech (multipart/form-data): audio (WAV) -> { text } (docs/DECISIONS.md FD-24).
// The audio goes only to the configured speech service and is never stored.
export async function GET() {
  try {
    return ok({ available: configuredTranscriber() !== null });
  } catch {
    return ok({ available: false });
  }
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
    return fail(503, 'LIBRARY_NOT_READY', "Couldn't hear that right now. Try again, or type instead.", true);
  }
}
