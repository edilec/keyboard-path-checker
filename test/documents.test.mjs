/**
 * Reading the two documents, and what happens to an entry this tool refuses.
 *
 * The rule the first two tests defend: an entry refused while building the
 * index is OUT of the index, and a journey that names it is undetermined rather
 * than running against whichever copy happened to survive. With three entries
 * sharing a ref, deleting on the second collision would let the third walk
 * straight back in -- and then a journey would be checked against an entry this
 * tool had already said it could not resolve.
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { capture, dialogControls, dialogRegion, journeys, reportFor, ruleIds } from './support.mjs'

test('three controls sharing a ref leave none of them in the index', async () => {
  const { code, report } = await reportFor({
    'controls.json': capture({
      controls: [
        { ref: 'thing', tabbable: true, activatedBy: ['Enter'] },
        { ref: 'thing', tabbable: false, activatedBy: ['Enter'] },
        { ref: 'thing', tabbable: true, activatedBy: ['Enter'] },
      ],
    }),
    'journeys.json': journeys([{ id: 'j', steps: [{ tabTo: 'thing' }] }]),
  })
  assert.equal(code, 2)
  assert.equal(report.summary.controls, 0, 'a refused ref walked back into the index')
  assert.equal(report.findings.filter((entry) => entry.ruleId === 'control-duplicate-ref').length, 2)
  assert.ok(ruleIds(report).includes('control-undeclared'))
  assert.ok(!ruleIds(report).includes('control-not-reachable'), 'a refused entry was still judged')
})

test('three regions sharing a ref leave none of them in the index', async () => {
  const { code, report } = await reportFor({
    'controls.json': capture({
      controls: dialogControls(),
      regions: [...dialogRegion(), ...dialogRegion({ modal: false }), ...dialogRegion()],
    }),
    'journeys.json': journeys([{ id: 'j', steps: [{ press: 'Enter', on: 'open-dialog' }] }]),
  })
  assert.equal(code, 2)
  assert.equal(report.summary.regions, 0, 'a refused ref walked back into the index')
  assert.ok(ruleIds(report).includes('region-undeclared'))
})

test('a malformed entry and a valid one sharing a ref give the same verdict in either order', async () => {
  // The refusal used to be registered only on the collision path, so a
  // malformed entry left no trace of its ref: the valid entry that followed
  // passed the duplicate check, walked into the index and was given a definite
  // verdict against a ref the document declares twice. Swapping the two flipped
  // the verdict, which is how the hole showed.
  const valid = { ref: 'thing', tabbable: true, activatedBy: ['pointer'] }
  const malformed = { ref: 'thing', opens: 123 }
  const orders = [[malformed, valid], [valid, malformed]]
  const seen = []
  for (const controls of orders) {
    const { code, report } = await reportFor({
      'controls.json': capture({ controls }),
      'journeys.json': journeys([{ id: 'j', steps: [{ press: 'Enter', on: 'thing' }] }]),
    })
    assert.equal(code, 2)
    assert.equal(report.summary.controls, 0, 'a refused ref walked back into the index')
    assert.ok(ruleIds(report).includes('control-duplicate-ref'), 'the duplicate was not reported at all')
    assert.ok(ruleIds(report).includes('control-undeclared'))
    assert.ok(!ruleIds(report).includes('pointer-only-activation'), 'a definite verdict came out of an index this run dropped a conflicting entry from')
    seen.push(report.summary.controls)
  }
  assert.deepEqual(seen, [0, 0])
})

test('a malformed region and a valid one sharing a ref give the same verdict in either order', async () => {
  const valid = { ref: 'confirm', modal: true, dismissKeys: ['Escape'], initialFocus: 'confirm-cancel', restoresFocusTo: 'open-dialog' }
  const malformed = { ref: 'confirm', modal: 'yes' }
  for (const regions of [[malformed, valid], [valid, malformed]]) {
    const { code, report } = await reportFor({
      'controls.json': capture({ controls: dialogControls(), regions }),
      'journeys.json': journeys([{ id: 'j', steps: [{ press: 'Enter', on: 'open-dialog' }] }]),
    })
    assert.equal(code, 2)
    assert.equal(report.summary.regions, 0, 'a refused ref walked back into the index')
    assert.ok(ruleIds(report).includes('region-duplicate-ref'))
    assert.ok(ruleIds(report).includes('region-undeclared'))
  }
})

test('a control this tool refused is reported as undescribed, not resolved anyway', async () => {
  const controls = dialogControls()
  controls[1].tabbable = 'yes'
  const { code, report } = await reportFor({
    'controls.json': capture({ controls, regions: dialogRegion() }),
    'journeys.json': journeys([{ id: 'j', steps: [{ tabTo: 'open-dialog' }] }]),
  })
  assert.equal(code, 2)
  assert.ok(ruleIds(report).includes('capture-invalid'))
  assert.ok(ruleIds(report).includes('control-undeclared'))
  assert.ok(!ruleIds(report).includes('control-not-reachable'))
})

test('a region that points focus at a control the capture does not describe says so readably', async () => {
  const { report } = await reportFor({
    'controls.json': capture({ controls: dialogControls(), regions: dialogRegion({ restoresFocusTo: 'nowhere' }) }),
    'journeys.json': journeys([{ id: 'j', steps: [{ press: 'Enter', on: 'open-dialog' }, { press: 'Escape' }] }]),
  })
  const finding = report.findings.find((entry) => entry.ruleId === 'control-undeclared')
  assert.equal(
    finding.message,
    '"confirm" restores focus to "nowhere", and this capture does not describe it. Where focus went was not checked.',
  )
})

test('a region whose initialFocus is undescribed says so readably too', async () => {
  const { report } = await reportFor({
    'controls.json': capture({ controls: dialogControls(), regions: dialogRegion({ initialFocus: 'nowhere' }) }),
    'journeys.json': journeys([{ id: 'j', steps: [{ press: 'Enter', on: 'open-dialog' }] }]),
  })
  const finding = report.findings.find((entry) => entry.ruleId === 'control-undeclared')
  assert.equal(
    finding.message,
    '"confirm" takes focus to "nowhere", and this capture does not describe it. Where focus went was not checked.',
  )
})

test('a step that names an undescribed control says so readably', async () => {
  const { report } = await reportFor({
    'controls.json': capture({ controls: dialogControls(), regions: dialogRegion() }),
    'journeys.json': journeys([{ id: 'j', steps: [{ tabTo: 'nowhere' }] }]),
  })
  const finding = report.findings.find((entry) => entry.ruleId === 'control-undeclared')
  assert.equal(
    finding.message,
    'This step names the control "nowhere", and this capture does not describe it. The step was not run.',
  )
})

const UNKNOWN_FIELD_PLACES = [
  { where: 'the capture envelope', files: { 'controls.json': '{ "schemaVersion": "1", "controls": [], "control": [] }' }, pointer: '/control' },
  { where: 'the capture block', files: { 'controls.json': '{ "schemaVersion": "1", "capture": { "activationObserved": true, "when": "x" }, "controls": [] }' }, pointer: '/capture/when' },
  { where: 'a control', files: { 'controls.json': '{ "schemaVersion": "1", "controls": [{ "ref": "a", "tabbable": true, "focusable": true }] }' }, pointer: '/controls/0/focusable' },
  { where: 'a region', files: { 'controls.json': '{ "schemaVersion": "1", "controls": [], "regions": [{ "ref": "r", "dialog": true }] }' }, pointer: '/regions/0/dialog' },
  { where: 'the journeys envelope', files: { 'journeys.json': '{ "schemaVersion": "1", "journeys": [], "journey": [] }' }, pointer: '/journey' },
  { where: 'a journey', files: { 'journeys.json': '{ "schemaVersion": "1", "journeys": [{ "id": "j", "steps": [], "notes": "x" }] }' }, pointer: '/journeys/0/notes' },
  { where: 'a step', files: { 'journeys.json': '{ "schemaVersion": "1", "journeys": [{ "id": "j", "steps": [{ "tabTo": "a", "with": "x" }] }] }' }, pointer: '/journeys/0/steps/0/with' },
]

for (const { where, files, pointer } of UNKNOWN_FIELD_PLACES) {
  test(`an unknown field on ${where} is refused, not ignored`, async () => {
    const { code, report } = await reportFor({
      'controls.json': capture({ controls: dialogControls(), regions: dialogRegion() }),
      'journeys.json': journeys([{ id: 'j', steps: [{ tabTo: 'orders-table' }] }]),
      ...files,
    })
    assert.equal(code, 2, where)
    const finding = report.findings.find((entry) => entry.ruleId === 'unknown-field' && entry.location.pointer === pointer)
    assert.ok(finding !== undefined, `${where}: ${JSON.stringify(report.findings.map((entry) => [entry.ruleId, entry.location.pointer]))}`)
    assert.match(finding.message, /refused rather than ignored/)
  })
}

test('a field left out says "not observed", and a field written null says the same', async () => {
  const both = [
    capture({ controls: [{ ref: 'a', activatedBy: ['Enter'] }] }),
    capture({ controls: [{ ref: 'a', activatedBy: ['Enter'], tabbable: null }] }),
  ]
  for (const controls of both) {
    const { code, report } = await reportFor({
      'controls.json': controls,
      'journeys.json': journeys([{ id: 'j', steps: [{ tabTo: 'a' }] }]),
    })
    assert.equal(code, 2)
    assert.ok(ruleIds(report).includes('tabbable-undetermined'))
  }
})
