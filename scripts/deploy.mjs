// Uploads the orders notebook to Cloudflare in one go:
//   1. the "sales" Worker (orders, accounts, 12:00 reminders),
//   2. the "shekvetebi" Pages site at https://shekvetebi.pages.dev
// Run it with upload-to-cloudflare.cmd (Windows) or `npm run deploy`.
import {spawn} from 'node:child_process';
import {createECDH} from 'node:crypto';
import {readFile, writeFile, unlink, mkdtemp, cp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createInterface} from 'node:readline/promises';

const PAGES_PROJECT = 'shekvetebi';
const WORKER = 'sales';
const project = fileURLToPath(new URL('..', import.meta.url));
const wrangler = join(project, 'node_modules', 'wrangler', 'bin', 'wrangler.js');

function run(args, {cwd = project, quiet = false} = {}) {
  return new Promise((done, fail) => {
    const child = spawn(process.execPath, [wrangler, ...args], {cwd, stdio: quiet ? ['inherit', 'pipe', 'pipe'] : 'inherit', env: {...process.env, WRANGLER_SEND_METRICS: 'false'}});
    let output = '';
    if (quiet) {
      child.stdout.on('data', chunk => { output += chunk; });
      child.stderr.on('data', chunk => { output += chunk; });
    }
    child.on('error', fail);
    child.on('exit', code => (code === 0 ? done(output) : fail(Object.assign(new Error('ბრძანება ვერ შესრულდა. შეცდომა ზემოთაა.'), {output}))));
  });
}

async function ask(question) {
  const rl = createInterface({input: process.stdin, output: process.stdout});
  try { return (await rl.question(question)).trim(); } finally { rl.close(); }
}

const say = text => process.stdout.write(text + '\n');

async function secrets() {
  const file = join(project, 'deployment-secrets.json');
  let values = {};
  try { values = JSON.parse(await readFile(file, 'utf8')); } catch {}
  delete values.APP_PASSWORD; // the old shared password is no longer used
  if (!values.VAPID_PUBLIC_KEY || !values.VAPID_PRIVATE_KEY) {
    const key = createECDH('prime256v1');
    key.generateKeys();
    values.VAPID_PUBLIC_KEY = key.getPublicKey().toString('base64url');
    values.VAPID_PRIVATE_KEY = key.getPrivateKey().toString('base64url');
  }
  if (!values.VAPID_SUBJECT) {
    const email = await ask('შენი ელფოსტა (შეტყობინებების სერვისისთვის, კლიენტებს არ ეგზავნებათ): ');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('ელფოსტა სწორად ჩაწერე.');
    values.VAPID_SUBJECT = 'mailto:' + email;
  }
  if (!values.GOOGLE_CLIENT_ID || !values.GOOGLE_CLIENT_SECRET) {
    say('\nGoogle-ით შესვლა (თუ ჯერ არ გაქვს Google-ის გასაღებები, უბრალოდ დააჭირე Enter-ს და მოგვიანებით დაამატებ).');
    const id = await ask('Google Client ID: ');
    if (id) {
      const secret = await ask('Google Client Secret: ');
      if (!secret) throw new Error('Client Secret ცარიელია. თავიდან გაუშვი და ორივე ჩაწერე.');
      values.GOOGLE_CLIENT_ID = id;
      values.GOOGLE_CLIENT_SECRET = secret;
    }
  }
  await writeFile(file, JSON.stringify(values, null, 2));
  await unlink(join(project, '.initial-password')).catch(() => {});
  return file;
}

async function pagesFolder() {
  const root = await mkdtemp(join(tmpdir(), PAGES_PROJECT + '-'));
  const dist = join(root, 'dist');
  await cp(join(project, 'public'), dist, {recursive: true});
  await cp(join(project, 'pages-site', '_worker.js'), join(dist, '_worker.js'));
  await cp(join(project, 'pages-site', '_routes.json'), join(dist, '_routes.json'));
  await writeFile(join(root, 'wrangler.json'), JSON.stringify({
    name: PAGES_PROJECT,
    pages_build_output_dir: './dist',
    compatibility_date: '2026-10-08',
    services: [{binding: 'API', service: WORKER}]
  }, null, 2));
  return root;
}

async function main() {
  say('\nშეკვეთების რვეული — ატვირთვა Cloudflare-ზე\n');
  say('ნაბიჯი 1/4: Cloudflare-ში შესვლის შემოწმება. თუ ბრაუზერი გაიხსნება, დაადასტურე (Allow).');
  try { await run(['whoami'], {quiet: true}); } catch { await run(['login']); }

  say('\nნაბიჯი 2/4: გასაღებების მომზადება.');
  const secretsFile = await secrets();

  say('\nნაბიჯი 3/4: სერვერის ნაწილი (შეკვეთები, ექაუნთები, 12:00-ის შეხსენება).');
  say('თუ გკითხავს „continue?“, დააჭირე Enter-ს.');
  await run(['d1', 'migrations', 'apply', 'DB', '--remote']);
  await run(['deploy', '--secrets-file', secretsFile]);

  say('\nნაბიჯი 4/4: საიტი shekvetebi.pages.dev.');
  const root = await pagesFolder();
  try {
    try {
      await run(['pages', 'project', 'create', PAGES_PROJECT, '--production-branch', 'main'], {cwd: root, quiet: true});
      say('Pages პროექტი შეიქმნა.');
    } catch (error) {
      if (!/already exists|8000002|taken/i.test(error.output || '')) say('(Pages პროექტი უკვე არსებობს ან ვერ შეიქმნა — ვცდი ატვირთვას.)');
    }
    await run(['pages', 'deploy', '--project-name', PAGES_PROJECT, '--branch', 'main', '--commit-dirty=true'], {cwd: root});
  } finally {
    await rm(root, {recursive: true, force: true}).catch(() => {});
  }

  say(`\nმზადაა! საიტი: https://${PAGES_PROJECT}.pages.dev`);
  say('ძველი მისამართი ავტომატურად ახალზე გადაგიყვანს.');
  say('deployment-secrets.json პირადი ფაილია. შეინახე და არავის გაუზიარო.');
}

main().catch(error => {
  process.stderr.write('\n' + (error.message || error) + '\n');
  process.exitCode = 1;
});
