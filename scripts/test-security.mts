/**
 * Upload checks and browser security headers (FD-93). No database, no server.
 *
 *   npm run test:security
 */
const { checkUploadFile, checkUploadSize, uploadMaxBytes } = await import('../features/slide-vault/server/upload-guard');
const config = (await import('../next.config')).default;

let failures = 0;
function check(ok: boolean, label: string, detail: unknown = '') {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? ` — ${JSON.stringify(detail)}` : ''}`);
}
const code = async (r: Response | null) => (r ? `${r.status} ${((await r.json()) as { error: { code: string } }).error.code}` : 'ok');
const zip = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4]);

check((await code(await checkUploadFile(new File([zip], 'Deck.pptx')))) === 'ok', 'upload: a real .pptx (zip inside) goes ahead');
check((await code(await checkUploadFile(new File([zip], 'deck.pdf')))) === '415 UNSUPPORTED_FILE_TYPE', 'upload: another file type is refused');
check((await code(await checkUploadFile(new File([new TextEncoder().encode('<script>alert(1)</script>')], 'evil.pptx')))) === '415 UNSUPPORTED_FILE_TYPE', 'upload: a file named .pptx that is not a PowerPoint file is refused');
check((await code(await checkUploadFile(new File([], 'empty.pptx')))) === '415 UNSUPPORTED_FILE_TYPE', 'upload: an empty file is refused');
check((await code(await checkUploadFile(new File([zip, new Uint8Array(2048)], 'big.pptx'), 1024))) === '413 FILE_TOO_LARGE', 'upload: a file over the limit is refused');
const big = new Request('http://x/api/uploads', { method: 'POST', headers: { 'content-length': String(3 * 1024 * 1024 * 1024) } });
check((await code(checkUploadSize(big))) === '413 FILE_TOO_LARGE', 'upload: an oversized request is refused before it is read');
check(uploadMaxBytes({}) === 1024 * 1048576 && uploadMaxBytes({ SV_UPLOAD_MAX_MB: '200' }) === 200 * 1048576 && uploadMaxBytes({ SV_UPLOAD_MAX_MB: 'x' }) === 1024 * 1048576, 'upload: SV_UPLOAD_MAX_MB, default 1024 (largest real deck about 910 MB)');

const rules = (await config.headers?.()) ?? [];
const h = new Map((rules[0]?.headers ?? []).map((x) => [x.key, x.value]));
check(rules[0]?.source === '/:path*', 'headers: on every page and API response');
check(h.get('X-Content-Type-Options') === 'nosniff' && h.get('Referrer-Policy') === 'strict-origin-when-cross-origin' && !!h.get('Strict-Transport-Security'), 'headers: no type sniffing, no full-address referrers, HTTPS only');
check(/microphone=\(self\)/.test(h.get('Permissions-Policy') ?? '') && /camera=\(\)/.test(h.get('Permissions-Policy') ?? ''), 'headers: microphone for this site only (talk to search), no camera');
check(/frame-ancestors 'self'/.test(h.get('Content-Security-Policy') ?? '') && /object-src 'none'/.test(h.get('Content-Security-Policy') ?? ''), 'headers: only this site may embed it; no plugins');

if (failures) {
  console.error(`\n${failures} security check(s) failed`);
  process.exit(1);
}
console.log('\nAll security checks passed');
process.exit(0);
