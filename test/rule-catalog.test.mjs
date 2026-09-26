/**
 * The catalog and the table agree, in both directions.
 *
 * This is a CONSISTENCY check and it is not the defence. A table, a document
 * and a test's expected map are three declarations that one coordinated edit
 * satisfies; `test/severity-outcomes.test.mjs` drives real documents through
 * the real CLI and asserts the exit code, which is what actually pins severity.
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import test from 'node:test'

import { LIMITATION_RULES, RULE_SEVERITY } from '../src/index.mjs'
import { PACKAGE_ROOT } from './support.mjs'

const ROW = /^\| `([a-z0-9-]+)` \| (error|warning|info) \| (yes|no) \|/gm

async function catalog() {
  const text = await readFile(join(PACKAGE_ROOT, 'docs', 'journey-rules.md'), 'utf8')
  const rules = new Map()
  for (const match of text.matchAll(ROW)) rules.set(match[1], { severity: match[2], limitation: match[3] === 'yes' })
  return rules
}

test('every rule in the table is documented with the same severity', async () => {
  const documented = await catalog()
  for (const [ruleId, severity] of Object.entries(RULE_SEVERITY)) {
    const row = documented.get(ruleId)
    assert.ok(row !== undefined, `${ruleId} is in RULE_SEVERITY and not in docs/journey-rules.md`)
    assert.equal(row.severity, severity, ruleId)
  }
})

test('every documented rule is in the table', async () => {
  const documented = await catalog()
  for (const ruleId of documented.keys()) {
    assert.ok(Object.hasOwn(RULE_SEVERITY, ruleId), `${ruleId} is in docs/journey-rules.md and not in RULE_SEVERITY`)
  }
})

test('the documented limitation column matches LIMITATION_RULES in both directions', async () => {
  const documented = await catalog()
  const declared = new Set(LIMITATION_RULES)
  for (const [ruleId, row] of documented) {
    assert.equal(row.limitation, declared.has(ruleId), `${ruleId} disagrees about being a limitation`)
  }
  for (const ruleId of declared) {
    assert.ok(documented.has(ruleId), `${ruleId} is in LIMITATION_RULES and not documented`)
    assert.ok(Object.hasOwn(RULE_SEVERITY, ruleId), `${ruleId} is in LIMITATION_RULES and not in RULE_SEVERITY`)
  }
})

test('the catalog is not empty, so the checks above cannot pass vacuously', async () => {
  const documented = await catalog()
  assert.ok(documented.size >= 38, `only ${documented.size} rows parsed out of docs/journey-rules.md`)
  assert.equal(documented.size, Object.keys(RULE_SEVERITY).length)
})

test('every warning-severity rule is also a limitation, which is why no passing run carries a warning', () => {
  const declared = new Set(LIMITATION_RULES)
  for (const [ruleId, severity] of Object.entries(RULE_SEVERITY)) {
    if (severity !== 'warning') continue
    assert.ok(declared.has(ruleId), `${ruleId} is a warning that is not a limitation, so it could ride along on a green run`)
  }
})
