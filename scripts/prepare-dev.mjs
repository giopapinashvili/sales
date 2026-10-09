// Local test settings for `npm run dev`: reminder keys only. No passwords are
// stored any more; accounts are created on the page itself.
import {createECDH} from 'node:crypto';
import {readFile, writeFile} from 'node:fs/promises';

const existing = await readFile('.dev.vars', 'utf8').catch(() => '');
const lines = existing.split(/\r?\n/).filter(line => line.trim() && !line.startsWith('APP_PASSWORD='));
if (!lines.some(line => line.startsWith('VAPID_PUBLIC_KEY='))) {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  lines.push(`VAPID_PUBLIC_KEY="${ecdh.getPublicKey().toString('base64url')}"`);
  lines.push(`VAPID_PRIVATE_KEY="${ecdh.getPrivateKey().toString('base64url')}"`);
  lines.push('VAPID_SUBJECT="mailto:local-test@example.com"');
}
await writeFile('.dev.vars', lines.join('\n') + '\n');
process.stdout.write('Local test configuration ready.\n');
