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
