/**
 * The journey machine's own behaviour, beyond the acceptance criteria.
 *
 * The tests here exist to stop the machine being right by accident: a modal
 * that confines, a non-modal one that does not, a `press` that checks
 * reachability before activation, and the places where a partly-read capture
 * has to stop the machine drawing a conclusion rather than letting it draw a
 * cheerful one.
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { capture, dialogControls, dialogRegion, journeys, reportFor, ruleIds } from './support.mjs'

test('a press with an "on" checks reachability exactly as tabTo does', async () => {
  const controls = dialogControls()
  controls[1].tabbable = false
  const { code, report } = await reportFor({
    'controls.json': capture({ controls, regions: dialogRegion() }),
    'journeys.json': journeys([{ id: 'j', steps: [{ press: 'Enter', on: 'open-dialog' }] }]),
  })
  assert.equal(code, 1)
  assert.ok(ruleIds(report).includes('control-not-reachable'))
  assert.ok(!ruleIds(report).includes('pointer-only-activation'), 'a control Tab cannot reach was still activated')
})

test('a modal region confines the tab order to itself, and a control inside it stays reachable', async () => {
  const { code, report } = await reportFor({
    'controls.json': capture({ controls: dialogControls(), regions: dialogRegion() }),
    'journeys.json': journeys([{
      id: 'j',
      steps: [{ press: 'Enter', on: 'open-dialog' }, { tabTo: 'confirm-ok' }, { press: 'Escape' }],
    }]),
  })
  assert.equal(code, 0, JSON.stringify(report.findings))
  assert.equal(report.journeys[0].endsFocusedOn, 'open-dialog')
})

test('a region declared not modal does not confine the tab order', async () => {
  const { code, report } = await reportFor({
    'controls.json': capture({ controls: dialogControls(), regions: dialogRegion({ modal: false }) }),
    'journeys.json': journeys([{
      id: 'j',
      steps: [{ press: 'Enter', on: 'open-dialog' }, { tabTo: 'orders-table' }, { press: 'Escape' }],
    }]),
  })
  assert.equal(code, 0, JSON.stringify(report.findings))
  assert.ok(!ruleIds(report).includes('unreachable-behind-modal'))
})

const WALKS_OUT = [{
  id: 'walks-out-of-the-dialog',
  steps: [{ press: 'Enter', on: 'open-dialog' }, { tabTo: 'orders-table' }, { press: 'Escape' }],
}]

test('a region whose modal the capture never declares is undetermined, not non-modal', async () => {
  // Three readings of one region have to give three different answers. An
  // omitted `modal` used to read as `modal: false`: this journey exited 0 with
  // status pass, zero findings and an empty notEvaluated, which is a verdict
  // drawn from a sentence the capture does not contain. `modal` is an
  // observation, like tabbable and dismissKeys -- somebody has to have tried
  // tabbing out of the region to know.
  const undeclared = dialogRegion()
  delete undeclared[0].modal
  const cases = [
    { label: 'omitted', regions: undeclared, code: 2, expect: 'modal-not-declared', absent: 'unreachable-behind-modal' },
    { label: 'null', regions: dialogRegion({ modal: null }), code: 2, expect: 'modal-not-declared', absent: 'unreachable-behind-modal' },
    { label: 'false', regions: dialogRegion({ modal: false }), code: 0, expect: null, absent: 'modal-not-declared' },
    { label: 'true', regions: dialogRegion({ modal: true }), code: 1, expect: 'unreachable-behind-modal', absent: 'modal-not-declared' },
  ]
  for (const { label, regions, code, expect, absent } of cases) {
    const result = await reportFor({
      'controls.json': capture({ controls: dialogControls(), regions }),
      'journeys.json': journeys(WALKS_OUT),
    })
    assert.equal(result.code, code, `${label}: ${JSON.stringify(result.report.findings)}`)
    if (expect !== null) assert.ok(ruleIds(result.report).includes(expect), label)
    assert.ok(!ruleIds(result.report).includes(absent), label)
  }
})

test('an undeclared modal leaves the run incomplete and says so in notEvaluated', async () => {
  const regions = dialogRegion()
  delete regions[0].modal
  const { code, report } = await reportFor({
    'controls.json': capture({ controls: dialogControls(), regions }),
    'journeys.json': journeys(WALKS_OUT),
  })
  assert.equal(code, 2)
  assert.equal(report.status, 'incomplete')
  assert.equal(report.summary.errors, 0, 'the incomplete flag alone is what keeps this off a green build')
  assert.deepEqual(report.summary.notEvaluated, ['modal-not-declared'])
  const finding = report.findings.find((entry) => entry.ruleId === 'modal-not-declared')
  assert.match(finding.message, /Not declared is not the same as not modal/)
  assert.equal(report.journeys[0].complete, false)
})

test('a step after an undeclared modal is not judged either, because focus never moved', async () => {
  const regions = dialogRegion()
  delete regions[0].modal
  const { code, report } = await reportFor({
    'controls.json': capture({ controls: dialogControls(), regions }),
    'journeys.json': journeys([{
      id: 'j',
      steps: [
        { press: 'Enter', on: 'open-dialog' },
        { tabTo: 'orders-table' },
        { expectFocus: 'orders-table' },
        { press: 'Escape' },
      ],
    }]),
  })
  assert.equal(code, 2)
  assert.ok(ruleIds(report).includes('focus-undetermined'))
  assert.ok(!ruleIds(report).includes('focus-mismatch'), 'an undetermined focus was compared anyway')
})

test('the walk past a non-modal region finds the modal one behind it', async () => {
  // The three answers are read innermost outward: a region the capture declares
  // non-modal confines nothing and the walk continues past it. This is the
  // branch that separates "declared false" from "not declared" -- the first is
  // skipped, the second stops the walk.
  const controls = [
    { ref: 'page-link', tabbable: true, activatedBy: ['Enter'] },
    { ref: 'open-outer', tabbable: true, activatedBy: ['Enter'], opens: 'outer' },
    { ref: 'open-inner', tabbable: true, activatedBy: ['Enter'], opens: 'inner', region: 'outer' },
    { ref: 'outer-only', tabbable: true, activatedBy: ['Enter'], region: 'outer' },
  ]
  const regions = [
    { ref: 'outer', modal: true, dismissKeys: ['Escape'], initialFocus: 'open-inner', restoresFocusTo: 'open-outer' },
    { ref: 'inner', modal: false, dismissKeys: ['Escape'], initialFocus: 'outer-only', restoresFocusTo: 'open-inner' },
  ]
  const open = [{ press: 'Enter', on: 'open-outer' }, { press: 'Enter', on: 'open-inner' }]
  const inside = await reportFor({
    'controls.json': capture({ controls, regions }),
    'journeys.json': journeys([{ id: 'j', steps: [...open, { tabTo: 'outer-only' }, { press: 'Escape' }, { press: 'Escape' }] }]),
  })
  assert.ok(!ruleIds(inside.report).includes('unreachable-behind-modal'), JSON.stringify(inside.report.findings))
  const outside = await reportFor({
    'controls.json': capture({ controls, regions }),
    'journeys.json': journeys([{ id: 'j', steps: [...open, { tabTo: 'page-link' }] }]),
  })
  assert.equal(outside.code, 1, JSON.stringify(outside.report.findings))
  const finding = outside.report.findings.find((entry) => entry.ruleId === 'unreachable-behind-modal')
  assert.match(finding.message, /modal region "outer" is open/)
  assert.ok(!ruleIds(outside.report).includes('modal-not-declared'))
})

test('an expectFocus before anything has been reached says nothing was focused yet', async () => {
  const { code, report } = await reportFor({
    'controls.json': capture({ controls: dialogControls(), regions: dialogRegion() }),
    'journeys.json': journeys([{ id: 'j', steps: [{ expectFocus: 'open-dialog' }] }]),
  })
  assert.equal(code, 1)
  const finding = report.findings.find((entry) => entry.ruleId === 'focus-mismatch')
  assert.match(finding.message, /nothing was focused yet/)
})

test('a region whose initialFocus names a control the capture does not describe is undetermined', async () => {
  const { code, report } = await reportFor({
    'controls.json': capture({ controls: dialogControls(), regions: dialogRegion({ initialFocus: 'nowhere' }) }),
    'journeys.json': journeys([{ id: 'j', steps: [{ press: 'Enter', on: 'open-dialog' }, { expectFocus: 'confirm-cancel' }] }]),
  })
  assert.equal(code, 2)
  assert.ok(ruleIds(report).includes('control-undeclared'))
  assert.ok(ruleIds(report).includes('focus-undetermined'))
  assert.ok(!ruleIds(report).includes('focus-mismatch'))
})

test('a control that declares both opens and dismisses is refused rather than resolved one way', async () => {
  const controls = dialogControls()
  controls[1].dismisses = 'confirm'
  const { code, report } = await reportFor({
    'controls.json': capture({ controls, regions: dialogRegion() }),
    'journeys.json': journeys([{ id: 'j', steps: [{ press: 'Enter', on: 'open-dialog' }] }]),
  })
  assert.equal(code, 2)
  const finding = report.findings.find((entry) => entry.ruleId === 'capture-invalid')
  assert.match(finding.message, /declares both opens and dismisses/)
  assert.ok(ruleIds(report).includes('control-undeclared'), 'the refused control must not stay in the index')
})

test('a step carrying "on" without a press is refused', async () => {
  const { code, report } = await reportFor({
    'controls.json': capture({ controls: dialogControls(), regions: dialogRegion() }),
    'journeys.json': journeys([{ id: 'j', steps: [{ tabTo: 'orders-table', on: 'open-dialog' }] }]),
  })
  assert.equal(code, 2)
  const finding = report.findings.find((entry) => entry.ruleId === 'journey-invalid')
  assert.match(finding.message, /"on" belongs to a "press" step/)
})

test('a step declaring two kinds at once is refused rather than resolved by precedence', async () => {
  const { code, report } = await reportFor({
    'controls.json': capture({ controls: dialogControls(), regions: dialogRegion() }),
    'journeys.json': journeys([{ id: 'j', steps: [{ tabTo: 'orders-table', expectFocus: 'orders-table' }] }]),
  })
  assert.equal(code, 2)
  const finding = report.findings.find((entry) => entry.ruleId === 'journey-invalid')
  assert.match(finding.message, /declares 2 of tabTo, press, expectFocus/)
})

test('two journeys are independent: the first leaving a region open does not confine the second', async () => {
  const { report } = await reportFor({
    'controls.json': capture({ controls: dialogControls(), regions: dialogRegion() }),
    'journeys.json': journeys([
      { id: 'leaves-it-open', steps: [{ press: 'Enter', on: 'open-dialog' }] },
      { id: 'starts-clean', steps: [{ tabTo: 'orders-table' }] },
    ]),
  })
  assert.deepEqual(report.journeys.map((entry) => entry.regionsLeftOpen), [['confirm'], []])
  assert.equal(report.findings.filter((entry) => entry.ruleId === 'unreachable-behind-modal').length, 0)
})

test('the summary counts what was checked, and a run that checked nothing says so', async () => {
  const { code, report } = await reportFor({
    'controls.json': capture({ controls: dialogControls(), regions: dialogRegion() }),
    'journeys.json': journeys([]),
  })
  assert.equal(report.summary.checked, 0)
  assert.ok(ruleIds(report).includes('nothing-checked'))
  assert.equal(code, 1)
})
