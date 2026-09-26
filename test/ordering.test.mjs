/**
 * Ordering, pinned behaviourally.
 *
 * Scanning this repository's own source for `.localeCompare(` is not a
 * determinism test: substituting `Intl.Collator` produces identical collation
 * drift with different source text, so the scan passes while the order becomes
 * machine-dependent.
 *
 * So the inputs below are chosen because code-unit order and collation order
 * genuinely DISAGREE about them -- `Z` before `a`, `a-b` before `a_b`, `README`
 * before `assets` -- they are pushed through the real report path, and the
 * exact emitted order is asserted. The second test asserts that the emitted
 * order is NOT the order a collator would give, so swapping one in fails here
 * rather than passing quietly.
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { capture, dialogControls, dialogRegion, journeys, reportFor } from './support.mjs'

const ADVERSARIAL = ['README', 'Zebra', 'a-b', 'a_b', 'assets']

function captureWithUnknownFields() {
  const control = { ref: 'thing', tabbable: true, activatedBy: ['Enter'] }
  for (const key of ADVERSARIAL) control[key] = true
  return capture({ controls: [control] })
}

test('findings sort by pointer using UTF-16 code units, not collation', async () => {
  const { report } = await reportFor({
    'controls.json': captureWithUnknownFields(),
    'journeys.json': journeys([{ id: 'j', steps: [{ tabTo: 'thing' }] }]),
  })
  const pointers = report.findings
    .filter((finding) => finding.ruleId === 'unknown-field')
    .map((finding) => finding.location.pointer)
  assert.deepEqual(pointers, ADVERSARIAL.map((key) => `/controls/0/${key}`))
})

test('the emitted order is not the order a collator would produce', async () => {
  const { report } = await reportFor({
    'controls.json': captureWithUnknownFields(),
    'journeys.json': journeys([{ id: 'j', steps: [{ tabTo: 'thing' }] }]),
  })
  const pointers = report.findings
    .filter((finding) => finding.ruleId === 'unknown-field')
    .map((finding) => finding.location.pointer)
  const collated = [...pointers].sort(new Intl.Collator('en').compare)
  assert.notDeepEqual(pointers, collated, 'these inputs must distinguish code-unit order from collation, or this test cannot fail')
  const byCodeUnit = [...pointers].sort((left, right) => (left === right ? 0 : left < right ? -1 : 1))
  assert.deepEqual(pointers, byCodeUnit)
})

test('the documented consequence holds: /steps/10 sorts before /steps/2', async () => {
  const steps = Array.from({ length: 11 }, () => ({ tabTo: 'thing' }))
  const { report } = await reportFor({
    'controls.json': capture({ controls: [{ ref: 'thing', tabbable: false, activatedBy: ['Enter'] }] }),
    'journeys.json': journeys([{ id: 'j', steps }]),
  })
  const pointers = report.findings
    .filter((finding) => finding.ruleId === 'control-not-reachable')
    .map((finding) => finding.location.pointer)
  assert.equal(pointers.length, 11)
  assert.deepEqual(pointers.slice(0, 4), [
    '/journeys/0/steps/0',
    '/journeys/0/steps/1',
    '/journeys/0/steps/10',
    '/journeys/0/steps/2',
  ])
})

test('the file key sorts before the pointer key', async () => {
  const { report } = await reportFor({
    'controls.json': capture({ controls: [{ ref: 'zzz', tabbable: false, activatedBy: ['Enter'] }] }),
    'journeys.json': journeys([{ id: 'j', steps: [{ tabTo: 'zzz' }] }, { id: 'j', steps: [{ tabTo: 'zzz' }] }]),
  })
  const files = report.findings.map((finding) => finding.location.file)
  assert.deepEqual([...new Set(files)], ['journeys.json'])
  const withCapture = await reportFor({
    'controls.json': capture({ controls: [{ ref: 'zzz', tabbable: false, activatedBy: ['Enter'], nope: 1 }] }),
    'journeys.json': journeys([{ id: 'j', steps: [{ tabTo: 'zzz' }] }]),
  })
  assert.deepEqual(withCapture.report.findings.map((finding) => finding.location.file), ['controls.json', 'journeys.json'])
})

test('journeys are reported in the order they are declared, not in any sorted order', async () => {
  const { report } = await reportFor({
    'controls.json': capture({ controls: dialogControls(), regions: dialogRegion() }),
    'journeys.json': journeys([
      { id: 'zeta', steps: [{ tabTo: 'orders-table' }] },
      { id: 'alpha', steps: [{ tabTo: 'orders-table' }] },
    ]),
  })
  assert.deepEqual(report.journeys.map((entry) => entry.id), ['zeta', 'alpha'])
})
