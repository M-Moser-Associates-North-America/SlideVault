/**
 * Changes your two starting passwords for M Moser's Supabase project (database login and
 * Storage account), as Alina's access sheet asks, then saves the new ones in .env.local.
 * Passwords are typed in hidden and never printed.
 *
 *   npx tsx scripts/change-mmoser-passwords.mts
 *
 * The database password is sent already scrambled (SCRAM-SHA-256), the same way psql's
 * \password does it, so the plain password never reaches the server or its logs.
 */
import { createHash, createHmac, pbkdf2Sync, randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { stdin, stdout } from 'node:process';
import pg from 'pg';
import { createClient } from '@supabase/supabase-js';

function ask(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    stdout.write(prompt);
    let value = '';
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    const onData = (ch: string) => {
      if (ch === '\r' || ch === '\n') {
        stdin.setRawMode(false); stdin.pause(); stdin.off('data', onData); stdout.write('\n'); resolve(value);
      } else if (ch === '\u0003') {
        stdout.write('\nCancelled\n'); process.exit(1);
      } else if (ch === '\u007f') {
        value = value.slice(0, -1);
      } else {
        value += ch;
      }
    };
    stdin.on('data', onData);
  });
}

async function newPassword(label: string): Promise<string> {
  for (;;) {
    const a = await ask(`New ${label} password (at least 16 characters, typing is hidden): `);
    if (a.length < 16) { console.log('Too short. Try again.'); continue; }
    const b = await ask(`Type it again: `);
    if (a !== b) { console.log("They didn't match. Try again."); continue; }
    return a;
  }
}

function scramVerifier(password: string): string {
  const salt = randomBytes(16);
  const iterations = 4096;
  const salted = pbkdf2Sync(password.normalize('NFKC'), salt, iterations, 32, 'sha256');
  const clientKey = createHmac('sha256', salted).update('Client Key').digest();
  const storedKey = createHash('sha256').update(clientKey).digest();
  const serverKey = createHmac('sha256', salted).update('Server Key').digest();
  return `SCRAM-SHA-256$${iterations}:${salt.toString('base64')}$${storedKey.toString('base64')}:${serverKey.toString('base64')}`;
}

const envText = readFileSync('.env.local', 'utf8');
const env: Record<string, string> = {};
for (const line of envText.split('\n')) {
  const m = /^(SV_[A-Z_]+)=(.*)$/.exec(line.trim());
  if (m) env[m[1]] = m[2].trim().replace(/^'(.*)'$/, '$1').replace(/^"(.*)"$/, '$1');
}
function saveSetting(name: string, value: string) {
  const text = readFileSync('.env.local', 'utf8');
  writeFileSync('.env.local', text.replace(new RegExp(`^${name}=.*$`, 'm'), `${name}='${value}'`  /* quoted: an unquoted # would cut the value short */));
}

// 1. Database password
const dbPassword = await newPassword('database');
const db = new pg.Client({
  host: env.SV_DB_HOST, port: Number(env.SV_DB_PORT), database: env.SV_DB_NAME,
  user: env.SV_DB_USER, password: env.SV_DB_PASSWORD, ssl: { rejectUnauthorized: false },
});
try {
  await db.connect();
  const role = (await db.query('select current_user as u')).rows[0].u as string;
  await db.query(`ALTER ROLE ${pg.escapeIdentifier(role)} PASSWORD ${pg.escapeLiteral(scramVerifier(dbPassword))}`);
  saveSetting('SV_DB_PASSWORD', dbPassword);
  console.log('Database password changed and saved in .env.local.');
} catch (e) {
  console.log('Database password NOT changed:', (e as Error).message);
} finally {
  await db.end().catch(() => {});
}

// 2. Storage password
const storagePassword = await newPassword('Storage');
const sb = createClient(env.SV_SUPABASE_URL, env.SV_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });
const signIn = await sb.auth.signInWithPassword({ email: env.SV_STORAGE_EMAIL, password: env.SV_STORAGE_PASSWORD });
if (signIn.error) {
  console.log('Storage password NOT changed (sign-in failed):', signIn.error.message);
} else {
  const upd = await sb.auth.updateUser({ password: storagePassword });
  if (upd.error) console.log('Storage password NOT changed:', upd.error.message);
  else { saveSetting('SV_STORAGE_PASSWORD', storagePassword); console.log('Storage password changed and saved in .env.local.'); }
  await sb.auth.signOut();
}
console.log('\nRun the access check again to confirm: npx tsx scripts/check-mmoser-access.mts');
