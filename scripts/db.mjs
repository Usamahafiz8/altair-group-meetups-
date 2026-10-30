// Database commands against the project in .env (DATABASE_URL), via the pinned
// Supabase CLI. No Docker and no `supabase login` needed.
//   npm run db:status   what would be applied (dry run)
//   npm run db:push     apply new migrations, then the seed (seed runs once per project)
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const CLI = 'supabase@2.122.0';
const cmd = process.argv[2];
if (!['status', 'push'].includes(cmd)) {
  console.error('usage: node scripts/db.mjs <status|push>');
  process.exit(2);
}
try {
  process.loadEnvFile('.env');
} catch {
  console.error('Missing .env: copy .env.example to .env and fill it in.');
  process.exit(1);
}
if (!process.env.DATABASE_URL?.startsWith('postgres')) {
  console.error('DATABASE_URL is not set in .env (Session pooler connection string).');
  process.exit(1);
}

// Run npm's own npx with this Node, without a shell: the URL holds a
// percent-encoded password that cmd.exe would otherwise try to expand.
if (!process.env.npm_execpath) {
  console.error('Run this through npm: npm run db:status / npm run db:push');
  process.exit(2);
}
const npx = path.join(path.dirname(process.env.npm_execpath), 'npx-cli.js');
const args = ['-y', CLI, 'db', 'push', '--db-url', process.env.DATABASE_URL, '--include-seed', '--yes'];
if (cmd === 'status') args.push('--dry-run');
const r = spawnSync(process.execPath, [npx, ...args], { stdio: 'inherit' });
process.exit(r.status ?? 1);
