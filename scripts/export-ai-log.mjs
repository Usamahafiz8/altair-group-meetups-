// Export this project's Claude Code session transcript(s) for submission, with
// secrets redacted. The .jsonl files are Claude Code's own history, copied as-is
// except for redaction; a readable Markdown rendering is written next to them.
//
//   node scripts/export-ai-log.mjs [--from <transcript dir>] [--out <dir>]
//
// Defaults: --from ~/.claude/projects/<slug of the folder Claude Code ran in>,
//           --out  ../submission/ai-session-log (outside the repo)
//
// Secrets are collected from .env AND from the transcript itself (passwords in
// postgres:// URLs, SUPABASE_DB_PASSWORD= values, JWT-shaped strings), so an old,
// since-rotated password that only appears in the log is still removed. The
// output is re-scanned and the script exits non-zero if anything survived.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : undefined;
};
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const slug = (p) => p.replace(/[^A-Za-z0-9]/g, '-');
const candidates = [path.dirname(repo), repo].flatMap((p) => [slug(p), slug(p[0].toLowerCase() + p.slice(1))]);
const from = arg('--from') ?? candidates.map((s) => path.join(os.homedir(), '.claude', 'projects', s)).find((d) => fs.existsSync(d));
const out = path.resolve(arg('--out') ?? path.join(repo, '..', 'submission', 'ai-session-log'));
if (!from || !fs.existsSync(from)) {
  console.error(`Transcript folder not found. Tried:\n  ${candidates.join('\n  ')}\nPass --from <dir>.`);
  process.exit(1);
}
const files = fs.readdirSync(from).filter((f) => f.endsWith('.jsonl'));
if (!files.length) {
  console.error(`No .jsonl transcripts in ${from}`);
  process.exit(1);
}

// ---- collect secret values -------------------------------------------------
const secrets = new Set();
const add = (v) => {
  if (!v || v.length < 6 || /^<.*>$/.test(v) || /^https?:\/\//.test(v)) return;
  secrets.add(v);
  try {
    secrets.add(decodeURIComponent(v));
  } catch {}
  secrets.add(encodeURIComponent(v));
};
const pgPassword = /postgres(?:ql)?:\/\/[^\s:@"'\\/]+:([^\s@"'\\]+)@/g;
const envPassword = /SUPABASE_DB_PASSWORD=([^\s"'\\]+)/g;
const jwt = /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/g;
const harvest = (text) => {
  for (const m of text.matchAll(pgPassword)) add(m[1]);
  for (const m of text.matchAll(envPassword)) add(m[1]);
  for (const m of text.matchAll(jwt)) add(m[0]);
};

const envFile = path.join(repo, '.env');
if (fs.existsSync(envFile)) {
  const env = fs.readFileSync(envFile, 'utf8');
  for (const line of env.split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m && /KEY|PASSWORD|SECRET|TOKEN|DATABASE_URL/.test(m[1])) add(m[2].trim());
  }
  harvest(env);
}
const raw = Object.fromEntries(files.map((f) => [f, fs.readFileSync(path.join(from, f), 'utf8')]));
Object.values(raw).forEach(harvest);

// Longest first, so a URL is replaced whole before the password inside it.
const ordered = [...secrets].sort((a, b) => b.length - a.length);
const variants = (s) => [s, JSON.stringify(s).slice(1, -1)];
const redact = (text) => {
  let n = 0;
  for (const s of ordered) {
    for (const v of variants(s)) {
      const parts = text.split(v);
      n += parts.length - 1;
      text = parts.join('[REDACTED]');
    }
  }
  return { text, n };
};

// ---- write ---------------------------------------------------------------------
fs.mkdirSync(out, { recursive: true });
let total = 0;
const summary = [];
for (const [f, text] of Object.entries(raw)) {
  const { text: clean, n } = redact(text);
  total += n;
  fs.writeFileSync(path.join(out, f), clean);
  fs.writeFileSync(path.join(out, f.replace(/\.jsonl$/, '.md')), toMarkdown(clean, f));
  summary.push(`${f}: ${clean.split('\n').length} lines, ${n} redactions`);
}

// ---- verify --------------------------------------------------------------------
const leftovers = fs
  .readdirSync(out)
  .filter((f) => /\.(jsonl|md)$/.test(f))
  .flatMap((f) => {
    const t = fs.readFileSync(path.join(out, f), 'utf8');
    return ordered.filter((s) => t.includes(s)).map(() => f);
  });
fs.writeFileSync(
  path.join(out, 'README.txt'),
  [
    'AI session log: Claude Code (model claude-opus-5-5), exported from Claude Code\'s own',
    `session history (${from}).`,
    '',
    'The .jsonl files are the original transcripts. The only change is redaction: credentials',
    '(database password and connection strings, API keys, JWTs) are replaced with [REDACTED].',
    'The .md files are a readable rendering of the same transcripts (messages and tool calls).',
    '',
    ...summary,
    `distinct secret values redacted: ${secrets.size}`,
  ].join('\n') + '\n',
);
console.log(`Exported ${files.length} transcript(s) to ${out}`);
console.log(summary.join('\n'));
if (leftovers.length) {
  console.error(`FAILED: secret values still present in ${[...new Set(leftovers)].join(', ')}`);
  process.exit(1);
}
console.log(`verified: no collected secret value remains (${total} redactions)`);

// ---- readable rendering --------------------------------------------------------
function toMarkdown(jsonl, name) {
  const lines = [`# Claude Code session ${name.replace('.jsonl', '')}`, ''];
  for (const line of jsonl.split('\n')) {
    if (!line.trim()) continue;
    let e;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    const msg = e.message;
    if (!msg || (e.type !== 'user' && e.type !== 'assistant')) continue;
    const when = e.timestamp ? ` · ${e.timestamp}` : '';
    const blocks = typeof msg.content === 'string' ? [{ type: 'text', text: msg.content }] : msg.content ?? [];
    for (const b of blocks) {
      if (b.type === 'text' && b.text?.trim()) {
        lines.push(`## ${e.type === 'user' ? 'User' : 'Claude'}${when}`, '', b.text.trim(), '');
      } else if (b.type === 'tool_use') {
        const input = JSON.stringify(b.input ?? {}, null, 2);
        lines.push(`### Tool call: ${b.name}${when}`, '', '```json', input.length > 4000 ? input.slice(0, 4000) + '\n…(truncated)' : input, '```', '');
      } else if (b.type === 'tool_result') {
        const body = (Array.isArray(b.content) ? b.content.map((c) => c.text ?? `[${c.type}]`).join('\n') : String(b.content ?? '')).trim();
        lines.push(`### Tool result${b.is_error ? ' (error)' : ''}`, '', '```', body.length > 3000 ? body.slice(0, 3000) + '\n…(truncated)' : body, '```', '');
      }
    }
  }
  return lines.join('\n');
}
