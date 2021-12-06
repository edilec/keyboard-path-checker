/**
 * A document may hold a value that THROWS when rendered.
 *
 * `String({toString: {}})` raises "Cannot convert object to primitive value",
 * and `{"toString": {}}` in a JSON document is enough to reach it -- before any
 * schema check, so on any document at all. Uncaught, that costs the whole
 * report: stdout is empty on exit 2, which is the shape reserved for a
 * configuration error, and one malformed document suppresses the findings for
 * every other input in the same run.
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { capture, dialogControls, dialogRegion, journeys, reportFor } from './support.mjs'

const HOSTILE = '{"toString": {}}'
const GOOD_CAPTURE = capture({ controls: dialogControls(), regions: dialogRegion() })
const GOOD_JOURNEYS = journeys([{ id: 'j', steps: [{ tabTo: 'orders-table' }] }])

const DOCUMENTS = [
  {
    where: 'schemaVersion of the capture',
    files: { 'controls.json': `{ "schemaVersion": ${HOSTILE}, "controls": [] }`, 'journeys.json': GOOD_JOURNEYS },
    rule: 'schema-version-unsupported',
    text: /declares schemaVersion an object/,
  },
  {
    where: 'controls',
    files: { 'controls.json': `{ "schemaVersion": "1", "controls": ${HOSTILE} }`, 'journeys.json': GOOD_JOURNEYS },
    rule: 'capture-invalid',
    text: /"controls" is an object, not an array/,
  },
  {
    where: 'a control entry ref',
    files: { 'controls.json': `{ "schemaVersion": "1", "controls": [{ "ref": ${HOSTILE} }] }`, 'journeys.json': GOOD_JOURNEYS },
    rule: 'capture-invalid',
    text: /ref is an object/,
  },
  {
    where: 'tabbable',
    files: { 'controls.json': `{ "schemaVersion": "1", "controls": [{ "ref": "a", "tabbable": ${HOSTILE} }] }`, 'journeys.json': GOOD_JOURNEYS },
    rule: 'capture-invalid',
    text: /"tabbable" is an object, not a boolean/,
  },
  {
    where: 'activatedBy',
    files: { 'controls.json': `{ "schemaVersion": "1", "controls": [{ "ref": "a", "tabbable": true, "activatedBy": ${HOSTILE} }] }`, 'journeys.json': GOOD_JOURNEYS },
    rule: 'capture-invalid',
    text: /activatedBy is an object, not an array/,
  },
  {
    where: 'an activatedBy entry',
    files: { 'controls.json': `{ "schemaVersion": "1", "controls": [{ "ref": "a", "tabbable": true, "activatedBy": [${HOSTILE}] }] }`, 'journeys.json': GOOD_JOURNEYS },
    rule: 'capture-invalid',
    text: /is not a list of what works/,
  },
  {
    where: 'the capture block',
    files: { 'controls.json': `{ "schemaVersion": "1", "capture": ${HOSTILE}, "controls": [] }`, 'journeys.json': GOOD_JOURNEYS },
    rule: 'capture-invalid',
    text: /"activationObserved" is undefined, not a boolean/,
  },
  {
    where: 'journeys',
    files: { 'controls.json': GOOD_CAPTURE, 'journeys.json': `{ "schemaVersion": "1", "journeys": ${HOSTILE} }` },
    rule: 'journey-invalid',
    text: /"journeys" is an object, not an array/,
  },
  {
    where: 'a journey id',
    files: { 'controls.json': GOOD_CAPTURE, 'journeys.json': `{ "schemaVersion": "1", "journeys": [{ "id": ${HOSTILE}, "steps": [] }] }` },
    rule: 'journey-invalid',
    text: /id is an object/,
  },
  {
    where: 'a step',
    files: { 'controls.json': GOOD_CAPTURE, 'journeys.json': `{ "schemaVersion": "1", "journeys": [{ "id": "j", "steps": [${HOSTILE}] }] }` },
    rule: 'journey-invalid',
    text: /declares none of tabTo, press, expectFocus/,
  },
  {
    where: 'a step value',
    files: { 'controls.json': GOOD_CAPTURE, 'journeys.json': `{ "schemaVersion": "1", "journeys": [{ "id": "j", "steps": [{ "tabTo": ${HOSTILE} }] }] }` },
    rule: 'journey-invalid',
    text: /"tabTo" is an object/,
  },
]

for (const { where, files, rule, text } of DOCUMENTS) {
  test(`a value that throws when rendered, at ${where}, is described by its shape and the report still arrives`, async () => {
    const { code, stdout, report } = await reportFor(files)
    assert.ok(stdout.length > 0, 'stdout was empty, which is the shape reserved for a configuration error')
    assert.equal(code, 2)
    const finding = report.findings.find((entry) => entry.ruleId === rule)
    assert.ok(finding !== undefined, `expected ${rule}, got ${report.findings.map((entry) => entry.ruleId).join(', ')}`)
    assert.match(finding.message, text)
  })
}

test('the shape description carries nothing of the document', async () => {
  const { report } = await reportFor({
    'controls.json': `{ "schemaVersion": "1", "controls": [{ "ref": { "toString": {}, "secret": "AKIAIOSFODNN7EXAMPLE" }, "tabbable": true }] }`,
    'journeys.json': GOOD_JOURNEYS,
  })
  assert.ok(!JSON.stringify(report).includes('AKIAIOSFODNN7EXAMPLE'))
})
