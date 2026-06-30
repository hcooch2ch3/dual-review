// Structural lint for SKILL.md: frontmatter + the synthesis-output contract
// that automation callers (e.g. dual-review-loop) parse by literal string.
// If these drift, programmatic callers fail closed — catch it in CI instead.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const skill = readFileSync(new URL('../skills/dual-review/SKILL.md', import.meta.url), 'utf8');

test('has YAML frontmatter with name + description', () => {
  const fm = skill.match(/^---\n([\s\S]*?)\n---/);
  assert.ok(fm, 'no frontmatter block at top of file');
  assert.match(fm[1], /(^|\n)name:\s*dual-review\b/, 'frontmatter missing name: dual-review');
  assert.match(fm[1], /(^|\n)description:\s*\S/, 'frontmatter missing description');
});

test('synthesis template carries the 4 caller-parsed headings (contract with dual-review-loop)', () => {
  for (const h of [
    '## ✅ Accept — 양쪽 독립 합치',
    '## ✅ Accept — 단일 리뷰어, 기술적으로 타당',
    '## ❌ Reject',
    '## Open Questions',
  ]) {
    assert.ok(skill.includes(h), `missing required heading: ${h}`);
  }
});

test('fail-closed integrity field is present and documented', () => {
  assert.ok(skill.includes('Review integrity:'), 'missing Review integrity header field');
  assert.ok(skill.includes('DEGRADED_BLOCKING'), 'missing DEGRADED_BLOCKING state');
});

test('nonce recovery contract is wired (markers + Step 1.5)', () => {
  assert.ok(skill.includes('===BEGIN-REVIEW-'), 'missing BEGIN nonce marker token');
  assert.ok(skill.includes('===END-REVIEW-'), 'missing END nonce marker token');
  assert.match(skill, /Step 1\.5/, 'missing Step 1.5 recovery step');
});

test('exactly one embedded ```js extractor block (the one tests run against)', () => {
  const count = (skill.match(/```js\b/g) || []).length;
  assert.equal(count, 1, `expected 1 \`\`\`js block, found ${count}`);
});
