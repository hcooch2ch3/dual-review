// Tests the review-recovery extractor that is EMBEDDED in SKILL.md.
// The point: test the committed artifact, not a hand-copy. We pull the ```js
// fenced block straight out of skills/dual-review/SKILL.md, then exercise it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// --- pull the extractor out of SKILL.md (handles fences indented inside a list) ---
const skillUrl = new URL('../skills/dual-review/SKILL.md', import.meta.url);
const lines = readFileSync(skillUrl, 'utf8').split('\n');
const start = lines.findIndex((l) => l.trim() === '```js');
assert.ok(start >= 0, 'no ```js extractor block found in SKILL.md');
const body = [];
for (let i = start + 1; i < lines.length; i++) {
  if (lines[i].trim() === '```') break;
  body.push(lines[i]);
}
const indent = Math.min(...body.filter((l) => l.trim()).map((l) => l.match(/^ */)[0].length));
const extractorSrc = body.map((l) => l.slice(indent)).join('\n');

const dir = mkdtempSync(join(tmpdir(), 'dr-extract-'));
const scriptPath = join(dir, 'extract.js');
writeFileSync(scriptPath, extractorSrc);

const N = '7f3a9c';
const B = `===BEGIN-REVIEW-${N}===`;
const E = `===END-REVIEW-${N}===`;
let seq = 0;

function jsonl(records) {
  const p = join(dir, `t-${seq++}.jsonl`);
  writeFileSync(p, records.map((r) => JSON.stringify(r)).join('\n'));
  return p;
}
function run(transcriptPath, nonce = N) {
  return execFileSync('node', [scriptPath, transcriptPath, nonce], { encoding: 'utf8' }).trim();
}
const asst = (text) => ({ message: { role: 'assistant', content: [{ type: 'text', text }] } });
const asstStr = (text) => ({ message: { role: 'assistant', content: text } });
const user = (text) => ({ message: { role: 'user', content: text } });

test('extractor block parses as valid JS', () => {
  execFileSync('node', ['-c', scriptPath]); // throws on SyntaxError
});

test('T1 basic: one well-formed pair recovers the body, ignores junk return turn', () => {
  assert.equal(run(jsonl([asst(`${B}\nREAL findings\n${E}`), asst('Complete.')])), 'REAL findings');
});

test('T2 draft+final: the LAST clean single-message pair wins', () => {
  assert.equal(run(jsonl([asst(`${B}\nDRAFT\n${E}`), asst(`${B}\nFINAL\n${E}`)])), 'FINAL');
});

test('T3 nested: 3 markers in one message → RECOVERY_FAILED (no clean pair)', () => {
  assert.equal(run(jsonl([asst(`${B}\nfoo\n${B}\nbar\n${E}`)])), 'RECOVERY_FAILED');
});

test('T4 quote-attack: a later turn quoting the END marker cannot over-capture the real body', () => {
  assert.equal(
    run(jsonl([asst(`${B}\nREAL body\n${E}`), asst(`I wrote it above between markers\n${E}\nok`)])),
    'REAL body',
  );
});

test('T5 string-shaped assistant content is handled', () => {
  assert.equal(run(jsonl([asstStr(`${B}\nstring review\n${E}`)])), 'string review');
});

test('T6 wrong nonce → RECOVERY_FAILED', () => {
  assert.equal(run(jsonl([asst(`${B}\nREAL\n${E}`)]), 'deadbeef'), 'RECOVERY_FAILED');
});

test('T7 markers inline (not alone on their line) → RECOVERY_FAILED', () => {
  assert.equal(run(jsonl([asst(`see ${B} and ${E} inline`)])), 'RECOVERY_FAILED');
});

test('T8 over-cap output is truncated with a sentinel', () => {
  const big = 'x'.repeat(17000);
  const out = run(jsonl([asst(`${B}\n${big}\n${E}`)]));
  assert.ok(out.endsWith('…[TRUNCATED]'), 'expected …[TRUNCATED] sentinel');
  assert.ok(out.length <= 16000 + 20, 'output should be capped near 16k');
});

test('T9 a GENERIC (nonce-less) marker inside the assistant review does not split extraction', () => {
  // the discriminating case: the marker token appears in the assistant message itself
  // (e.g. the reviewer quotes the generic ===BEGIN-REVIEW=== while discussing it).
  const out = run(jsonl([asst(`The artifact mentions ===BEGIN-REVIEW=== generically.\n${B}\nREAL body\n===END-REVIEW===\n${E}`)]));
  assert.equal(out, 'REAL body\n===END-REVIEW===');
});

test('T10 real harness-shaped fixture: recovers the marked review, skips thinking + tool noise + junk turn', () => {
  const fixture = new URL('./fixtures/real-shape.jsonl', import.meta.url);
  const out = execFileSync('node', [scriptPath, fixture.pathname, 'fixab12'], { encoding: 'utf8' }).trim();
  assert.match(out, /real-shape fixture finding one/);
  assert.doesNotMatch(out, /sanitized reasoning|thinking/i, 'thinking block leaked into recovered review');
  assert.doesNotMatch(out, /No further action needed/, 'junk return turn leaked into recovered review');
});
