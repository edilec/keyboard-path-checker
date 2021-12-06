/**
 * The incomplete flag, pinned behaviourally.
 *
 * Every case below produces a run with ZERO error-severity findings. The only
 * thing standing between each of them and a green exit 0 is the single
 * `incomplete = true` inside `addUnknown`. Delete it and every assertion here
 * fails, because `status` becomes "pass" and the exit code becomes 0 -- which
 * is exactly the mutation that let an entirely unread input report a pass in a
 * sibling tool with its whole suite still green.
 *
 * The last tests cover the other direction: a limitation whose severity IS
 * error must still exit 2 and not 1, and a real failure alongside a limitation
 * must not turn the run into a plain failure. Incomplete is not a worse kind of
 * failure -- it is a different statement.
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { capture, dialogControls, dialogRegion, journeys, reportFor, ruleIds } from './support.mjs'

const WARNING_ONLY = [
  {
    rule: 'activation-undetermined',
    files: {
      'controls.json': capture({ controls: dialogControls(), regions: dialogRegion(), activationObserved: false }),
      'journeys.json': journeys([{ id: 'open-it', steps: [{ press: 'Enter', on: 'open-dialog' }] }]),
    },
  },
  {
    rule: 'capture-not-declared',
    files: {
      'controls.json': capture({ controls: dialogControls(), regions: dialogRegion(), meta: null }),
      'journeys.json': journeys([{ id: 'reach-it', steps: [{ tabTo: 'orders-table' }] }]),
    },
  },
  {
    rule: 'dismiss-keys-not-declared',
    files: {
      'controls.json': capture({ controls: dialogControls(), regions: dialogRegion({ dismissKeys: undefined }) }),
      'journeys.json': journeys([{ id: 'open-and-escape', steps: [{ press: 'Enter', on: 'open-dialog' }, { press: 'Escape' }] }]),
    },
  },
  {
    rule: 'focus-return-not-declared',
    files: {
      'controls.json': capture({ controls: dialogControls(), regions: dialogRegion({ restoresFocusTo: undefined }) }),
      'journeys.json': journeys([{ id: 'open-and-escape', steps: [{ press: 'Enter', on: 'open-dialog' }, { press: 'Escape' }] }]),
    },
  },
  {
    rule: 'focus-undetermined',
    files: {
      'controls.json': capture({ controls: dialogControls(), regions: dialogRegion({ restoresFocusTo: undefined }) }),
      'journeys.json': journeys([{ id: 'open-and-escape', steps: [{ press: 'Enter', on: 'open-dialog' }, { press: 'Escape' }, { expectFocus: 'open-dialog' }] }]),
    },
  },
  {
    rule: 'region-without-initial-focus',
    files: {
      'controls.json': capture({ controls: dialogControls(), regions: dialogRegion({ initialFocus: undefined }) }),
      'journeys.json': journeys([{ id: 'open-and-escape', steps: [{ press: 'Enter', on: 'open-dialog' }, { press: 'Escape' }] }]),
    },
  },
  {
    rule: 'tabbable-undetermined',
    files: {
      'controls.json': capture({ controls: [{ ref: 'thing', role: 'button', name: 'Thing', activatedBy: ['Enter'] }] }),
      'journeys.json': journeys([{ id: 'reach-it', steps: [{ tabTo: 'thing' }] }]),
    },
  },
]

for (const { rule, files } of WARNING_ONLY) {
  test(`${rule} makes the run incomplete, with no error-severity finding to do it`, async () => {
    const { code, report } = await reportFor(files)
    assert.ok(ruleIds(report).includes(rule), `expected ${rule}, got ${ruleIds(report).join(', ')}`)
    assert.equal(report.summary.errors, 0, `${rule}: ${JSON.stringify(report.findings.filter((f) => f.severity === 'error'))}`)
    assert.equal(report.status, 'incomplete')
    assert.equal(code, 2)
    assert.ok(report.summary.notEvaluated.includes(rule))
  })
}

test('every warning-only case above is distinct, so none of them is a test that cannot fail', () => {
  assert.equal(new Set(WARNING_ONLY.map((entry) => entry.rule)).size, WARNING_ONLY.length)
  assert.ok(WARNING_ONLY.length >= 7)
})

test('a limitation whose severity is error still exits 2, not 1', async () => {
  const cases = [
    {
      rule: 'control-undeclared',
      files: {
        'controls.json': capture({ controls: dialogControls(), regions: dialogRegion() }),
        'journeys.json': journeys([{ id: 'j', steps: [{ tabTo: 'nowhere' }] }]),
      },
    },
    {
      rule: 'region-undeclared',
      files: {
        'controls.json': capture({ controls: dialogControls(), regions: [] }),
        'journeys.json': journeys([{ id: 'j', steps: [{ press: 'Enter', on: 'open-dialog' }] }]),
      },
    },
    {
      rule: 'control-duplicate-ref',
      files: {
        'controls.json': capture({ controls: [...dialogControls(), { ref: 'open-dialog', tabbable: false }], regions: dialogRegion() }),
        'journeys.json': journeys([{ id: 'j', steps: [{ tabTo: 'orders-table' }] }]),
      },
    },
    {
      rule: 'unknown-field',
      files: {
        'controls.json': capture({ controls: [{ ref: 'a', tabbable: true, tabable: true }] }),
        'journeys.json': journeys([{ id: 'j', steps: [{ tabTo: 'a' }] }]),
      },
    },
  ]
  for (const { rule, files } of cases) {
    const { code, report } = await reportFor(files)
    assert.ok(ruleIds(report).includes(rule), `expected ${rule}, got ${ruleIds(report).join(', ')}`)
    assert.ok(report.summary.errors > 0, rule)
    assert.equal(report.status, 'incomplete', rule)
    assert.equal(code, 2, rule)
  }
})

test('a real failure inside an incomplete run is still incomplete: unknown does not become fail either', async () => {
  const controls = dialogControls()
  controls[0].tabbable = false
  const { code, report } = await reportFor({
    'controls.json': capture({ controls, regions: dialogRegion(), activationObserved: false }),
    'journeys.json': journeys([{ id: 'j', steps: [{ tabTo: 'orders-table' }, { press: 'Enter', on: 'open-dialog' }] }]),
  })
  assert.ok(ruleIds(report).includes('control-not-reachable'))
  assert.ok(ruleIds(report).includes('activation-undetermined'))
  assert.ok(report.summary.errors > 0)
  assert.equal(report.status, 'incomplete')
  assert.equal(code, 2)
})

test('an undetermined region stack is reported as null, never as an empty list', async () => {
  const { report } = await reportFor({
    'controls.json': capture({ controls: dialogControls(), regions: dialogRegion(), activationObserved: false }),
    'journeys.json': journeys([{ id: 'j', steps: [{ press: 'Enter', on: 'open-dialog' }] }]),
  })
  assert.equal(report.journeys[0].regionsLeftOpen, null)
  assert.ok(!ruleIds(report).includes('region-left-open'))
})

test('a journey stops at a step this tool could not read, rather than running past it', async () => {
  const { code, report } = await reportFor({
    'controls.json': capture({ controls: dialogControls(), regions: dialogRegion() }),
    'journeys.json': journeys([{ id: 'j', steps: [{ tabTo: 'open-dialog' }, { press: 7 }, { expectFocus: 'orders-table' }] }]),
  })
  assert.equal(code, 2)
  const finding = report.findings.find((entry) => entry.ruleId === 'journey-invalid')
  assert.match(finding.message, /so the journey was not run/)
  assert.equal(report.summary.journeysRun, 0)
  assert.ok(!ruleIds(report).includes('focus-mismatch'))
})
