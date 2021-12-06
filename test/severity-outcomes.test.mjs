/**
 * Severity, pinned behaviourally.
 *
 * A frozen `RULE_SEVERITY` table, a documented catalog and a hand-written
 * expected map in a test are three DECLARATIONS, and one coordinated edit
 * satisfies all three: a sibling tool had 40 of its 52 error rules survive
 * exactly that flip. So nothing here reads the table. Each case drives real
 * documents through the real CLI and asserts the exit code, which is not a
 * declaration and cannot be edited into agreement.
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { capture, dialogControls, dialogRegion, journeys, reportFor, ruleIds } from './support.mjs'

const NESTED = {
  'controls.json': capture({
    controls: [
      { ref: 'openA', tabbable: true, activatedBy: ['Enter'], opens: 'A' },
      { ref: 'openB', tabbable: true, activatedBy: ['Enter'], opens: 'B', region: 'A' },
      { ref: 'closeA', tabbable: true, activatedBy: ['Enter'], dismisses: 'A', region: 'B' },
    ],
    regions: [
      { ref: 'A', modal: true, dismissKeys: ['Escape'], initialFocus: 'openB', restoresFocusTo: 'openA' },
      { ref: 'B', modal: true, dismissKeys: ['Escape'], initialFocus: 'closeA', restoresFocusTo: 'openB' },
    ],
  }),
  'journeys.json': journeys([{
    id: 'nested',
    steps: [
      { press: 'Enter', on: 'openA' },
      { press: 'Enter', on: 'openB' },
      { press: 'Enter', on: 'closeA' },
    ],
  }]),
}

/** An error rule that is NOT a limitation: the run failed, and it exits 1. */
const FAILS = [
  {
    rule: 'control-not-reachable',
    files: {
      'controls.json': capture({ controls: [{ ref: 'thing', tabbable: false, activatedBy: ['Enter'] }] }),
      'journeys.json': journeys([{ id: 'j', steps: [{ tabTo: 'thing' }] }]),
    },
  },
  { rule: 'dismiss-wrong-region', files: NESTED },
  {
    rule: 'focus-mismatch',
    files: {
      'controls.json': capture({ controls: dialogControls(), regions: dialogRegion() }),
      'journeys.json': journeys([{ id: 'j', steps: [{ tabTo: 'orders-table' }, { expectFocus: 'open-dialog' }] }]),
    },
  },
  {
    rule: 'focus-not-restored',
    files: {
      'controls.json': capture({ controls: dialogControls(), regions: dialogRegion({ restoresFocusTo: 'orders-table' }) }),
      'journeys.json': journeys([{ id: 'j', steps: [{ press: 'Enter', on: 'open-dialog' }, { press: 'Escape' }, { expectFocus: 'open-dialog' }] }]),
    },
  },
  {
    rule: 'journey-duplicate-id',
    files: {
      'controls.json': capture({ controls: dialogControls(), regions: dialogRegion() }),
      'journeys.json': journeys([
        { id: 'same', steps: [{ tabTo: 'orders-table' }] },
        { id: 'same', steps: [{ tabTo: 'orders-table' }] },
      ]),
    },
  },
  {
    rule: 'journey-without-steps',
    files: {
      'controls.json': capture({ controls: dialogControls(), regions: dialogRegion() }),
      'journeys.json': journeys([{ id: 'empty', steps: [] }, { id: 'real', steps: [{ tabTo: 'orders-table' }] }]),
    },
  },
  {
    rule: 'journeys-empty',
    files: {
      'controls.json': capture({ controls: dialogControls(), regions: dialogRegion() }),
      'journeys.json': journeys([]),
    },
  },
  {
    rule: 'key-does-not-dismiss',
    files: {
      'controls.json': capture({ controls: dialogControls(), regions: dialogRegion() }),
      'journeys.json': journeys([{ id: 'j', steps: [{ press: 'Enter', on: 'open-dialog' }, { press: 'Backspace' }] }]),
    },
  },
  {
    rule: 'key-not-activating',
    files: {
      'controls.json': capture({ controls: dialogControls({ activatedBy: ['Enter', 'pointer'] }), regions: dialogRegion() }),
      'journeys.json': journeys([{ id: 'j', steps: [{ press: 'Space', on: 'open-dialog' }] }]),
    },
  },
  {
    rule: 'no-controls-declared',
    files: {
      'controls.json': capture({ controls: [] }),
      'journeys.json': journeys([{ id: 'j', steps: [{ press: 'Escape' }] }]),
    },
  },
  {
    rule: 'nothing-checked',
    files: {
      'controls.json': capture({ controls: dialogControls(), regions: dialogRegion() }),
      'journeys.json': journeys([]),
    },
  },
  {
    rule: 'pointer-only-activation',
    files: {
      'controls.json': capture({ controls: dialogControls({ activatedBy: ['pointer'] }), regions: dialogRegion() }),
      'journeys.json': journeys([{ id: 'j', steps: [{ press: 'Enter', on: 'open-dialog' }] }]),
    },
  },
  {
    rule: 'region-left-open',
    files: {
      'controls.json': capture({ controls: dialogControls(), regions: dialogRegion() }),
      'journeys.json': journeys([{ id: 'j', steps: [{ press: 'Enter', on: 'open-dialog' }] }]),
    },
  },
  {
    rule: 'step-without-effect',
    files: {
      'controls.json': capture({ controls: dialogControls(), regions: dialogRegion() }),
      'journeys.json': journeys([{ id: 'j', steps: [{ press: 'Escape' }] }]),
    },
  },
  {
    rule: 'unreachable-behind-modal',
    files: {
      'controls.json': capture({ controls: dialogControls(), regions: dialogRegion() }),
      'journeys.json': journeys([{ id: 'j', steps: [{ press: 'Enter', on: 'open-dialog' }, { tabTo: 'orders-table' }] }]),
    },
  },
]

for (const { rule, files } of FAILS) {
  test(`${rule} fails the run: exit 1`, async () => {
    const { code, report } = await reportFor(files)
    assert.ok(ruleIds(report).includes(rule), `expected ${rule}, got ${ruleIds(report).join(', ')}`)
    assert.equal(report.status, 'fail', `${rule}: ${JSON.stringify(report.findings)}`)
    assert.equal(code, 1, rule)
    assert.equal(report.summary.warnings, 0, `${rule}: every warning in this tool is a limitation, so a failing run has none`)
  })
}

/** An error rule that IS a limitation: evidence was not obtained, so it exits 2. */
const INCOMPLETE = [
  {
    rule: 'capture-invalid',
    files: { 'controls.json': capture({ controls: [{ ref: 'a', tabbable: 'yes' }] }), 'journeys.json': journeys([{ id: 'j', steps: [{ tabTo: 'a' }] }]) },
    args: [],
  },
  {
    rule: 'control-undeclared',
    files: { 'controls.json': capture({ controls: dialogControls(), regions: dialogRegion() }), 'journeys.json': journeys([{ id: 'j', steps: [{ tabTo: 'nowhere' }] }]) },
    args: [],
  },
  {
    rule: 'control-duplicate-ref',
    files: { 'controls.json': capture({ controls: [{ ref: 'a', tabbable: true }, { ref: 'a', tabbable: false }] }), 'journeys.json': journeys([{ id: 'j', steps: [{ tabTo: 'a' }] }]) },
    args: [],
  },
  {
    rule: 'region-duplicate-ref',
    files: {
      'controls.json': capture({ controls: dialogControls(), regions: [...dialogRegion(), ...dialogRegion()] }),
      'journeys.json': journeys([{ id: 'j', steps: [{ tabTo: 'orders-table' }] }]),
    },
    args: [],
  },
  {
    rule: 'region-undeclared',
    files: { 'controls.json': capture({ controls: dialogControls(), regions: [] }), 'journeys.json': journeys([{ id: 'j', steps: [{ press: 'Enter', on: 'open-dialog' }] }]) },
    args: [],
  },
  {
    rule: 'journey-invalid',
    files: { 'controls.json': capture({ controls: dialogControls(), regions: dialogRegion() }), 'journeys.json': journeys([{ id: 'j', steps: [{ tabTo: 'a', press: 'Enter' }] }]) },
    args: [],
  },
  {
    rule: 'unknown-field',
    files: { 'controls.json': capture({ controls: [{ ref: 'a', tabbable: true, focusable: true }] }), 'journeys.json': journeys([{ id: 'j', steps: [{ tabTo: 'a' }] }]) },
    args: [],
  },
  {
    rule: 'schema-version-unsupported',
    files: { 'controls.json': '{ "schemaVersion": "2", "controls": [] }', 'journeys.json': journeys([{ id: 'j', steps: [{ tabTo: 'a' }] }]) },
    args: [],
  },
  {
    rule: 'input-not-json',
    files: { 'controls.json': '{ "schemaVersion"', 'journeys.json': journeys([{ id: 'j', steps: [{ tabTo: 'a' }] }]) },
    args: [],
  },
  {
    rule: 'input-not-utf8',
    files: { 'controls.json': Buffer.from([0x7b, 0xff, 0xfe, 0x7d]), 'journeys.json': journeys([{ id: 'j', steps: [{ tabTo: 'a' }] }]) },
    args: [],
  },
  {
    rule: 'input-too-large',
    files: { 'controls.json': capture({ controls: dialogControls(), regions: dialogRegion() }), 'journeys.json': journeys([{ id: 'j', steps: [{ tabTo: 'orders-table' }] }]) },
    args: ['--max-document-bytes', '10'],
  },
  {
    rule: 'input-unreadable',
    files: { 'journeys.json': journeys([{ id: 'j', steps: [{ tabTo: 'a' }] }]) },
    args: [],
  },
  {
    rule: 'too-many-controls',
    files: { 'controls.json': capture({ controls: dialogControls(), regions: dialogRegion() }), 'journeys.json': journeys([{ id: 'j', steps: [{ tabTo: 'orders-table' }] }]) },
    args: ['--max-controls', '2'],
  },
  {
    rule: 'too-many-findings',
    files: {
      'controls.json': capture({ controls: dialogControls(), regions: dialogRegion() }),
      'journeys.json': journeys([{ id: 'j', steps: [{ tabTo: 'nowhere' }, { tabTo: 'nowhere-else' }] }]),
    },
    args: ['--max-findings', '1'],
  },
  {
    rule: 'too-many-journeys',
    files: {
      'controls.json': capture({ controls: dialogControls(), regions: dialogRegion() }),
      'journeys.json': journeys([{ id: 'a', steps: [{ tabTo: 'orders-table' }] }, { id: 'b', steps: [{ tabTo: 'orders-table' }] }]),
    },
    args: ['--max-journeys', '1'],
  },
  {
    rule: 'too-many-steps',
    files: {
      'controls.json': capture({ controls: dialogControls(), regions: dialogRegion() }),
      'journeys.json': journeys([{ id: 'j', steps: [{ tabTo: 'orders-table' }, { tabTo: 'orders-table' }] }]),
    },
    args: ['--max-steps-per-journey', '1'],
  },
]

for (const { rule, files, args } of INCOMPLETE) {
  test(`${rule} makes the run incomplete: exit 2, never 1 and never 0`, async () => {
    const { code, report } = await reportFor(files, args)
    assert.ok(ruleIds(report).includes(rule), `expected ${rule}, got ${ruleIds(report).join(', ')}`)
    assert.equal(report.status, 'incomplete', rule)
    assert.equal(code, 2, rule)
  })
}

test('a document that resolves outside the root is refused, and the run is incomplete', async () => {
  const { code, report } = await reportFor({
    'controls.json': capture({ controls: dialogControls(), regions: dialogRegion() }),
    'journeys.json': journeys([{ id: 'j', steps: [{ tabTo: 'orders-table' }] }]),
  }, ['--capture', '../elsewhere.json'])
  assert.ok(ruleIds(report).includes('path-escapes-root'))
  assert.equal(report.status, 'incomplete')
  assert.equal(code, 2)
})

/**
 * Every warning-severity rule in this tool is also a limitation, so a warning
 * can never appear on a run that exits 0 or 1. That is an invariant about the
 * two lists, and it is checked here the only way that cannot be edited into
 * agreement: by running documents that produce warnings and reading the exit
 * code.
 */
const WARNING_CASES = [
  {
    why: 'an activation nobody observed',
    files: {
      'controls.json': capture({ controls: dialogControls(), regions: dialogRegion(), activationObserved: false }),
      'journeys.json': journeys([{ id: 'j', steps: [{ press: 'Enter', on: 'open-dialog' }] }]),
    },
  },
  {
    why: 'a region that does not say where focus returns',
    files: {
      'controls.json': capture({ controls: dialogControls(), regions: dialogRegion({ restoresFocusTo: undefined }) }),
      'journeys.json': journeys([{ id: 'j', steps: [{ press: 'Enter', on: 'open-dialog' }, { press: 'Escape' }, { expectFocus: 'open-dialog' }] }]),
    },
  },
  {
    why: 'a control that does not say whether Tab reaches it',
    files: {
      'controls.json': capture({ controls: [{ ref: 'thing', activatedBy: ['Enter'] }] }),
      'journeys.json': journeys([{ id: 'j', steps: [{ tabTo: 'thing' }] }]),
    },
  },
]

test('every warning this tool can raise is a limitation, so a run with a warning never exits 0 or 1', async () => {
  let seenWarning = false
  for (const { why, files } of WARNING_CASES) {
    const { code, report } = await reportFor(files)
    assert.ok(report.summary.warnings > 0, why)
    seenWarning = true
    assert.equal(code, 2, `${why}: a run with ${report.summary.warnings} warning(s) exited ${code}`)
  }
  for (const { rule, files } of FAILS) {
    const { report } = await reportFor(files)
    assert.equal(report.summary.warnings, 0, rule)
  }
  assert.ok(seenWarning, 'no case above produced a warning, so this check cannot fail')
})
