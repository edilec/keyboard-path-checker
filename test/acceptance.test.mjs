/**
 * The acceptance criteria, item by item.
 *
 *   "A dialog's open/close path restores focus; a pointer-only interaction
 *    fails its keyboard contract."
 *
 * Each test names the clause it defends. The tests that matter most are the
 * ones directly after each clause: they take the SAME journey and remove the
 * evidence, and assert that the verdict becomes undetermined rather than
 * staying a verdict.
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  OPEN_AND_ESCAPE, capture, dialogControls, dialogRegion, journeys, reportFor, ruleIds, runCli,
  makeRoot, removeRoot,
} from './support.mjs'

test("a dialog's open/close path restores focus: Escape returns focus to the control that opened it", async () => {
  const { code, report } = await reportFor({
    'controls.json': capture({ controls: dialogControls(), regions: dialogRegion() }),
    'journeys.json': journeys(OPEN_AND_ESCAPE),
  })
  assert.equal(report.status, 'pass')
  assert.equal(code, 0)
  assert.deepEqual(report.findings, [])
  assert.equal(report.journeys[0].endsFocusedOn, 'open-dialog')
  assert.equal(report.journeys[0].endsFocusDetermined, true)
  assert.deepEqual(report.journeys[0].regionsLeftOpen, [])
})

test("a dialog's open/close path restores focus: the dismiss control returns focus the same way", async () => {
  const { code, report } = await reportFor({
    'controls.json': capture({ controls: dialogControls(), regions: dialogRegion() }),
    'journeys.json': journeys([{
      id: 'open-and-cancel',
      steps: [
        { press: 'Space', on: 'open-dialog' },
        { expectFocus: 'confirm-cancel' },
        { press: 'Enter', on: 'confirm-cancel' },
        { expectFocus: 'open-dialog' },
      ],
    }]),
  })
  assert.equal(code, 0)
  assert.equal(report.journeys[0].endsFocusedOn, 'open-dialog')
})

test('focus that does not come back is reported, and the message says what it costs', async () => {
  const { code, report } = await reportFor({
    'controls.json': capture({ controls: dialogControls(), regions: dialogRegion({ restoresFocusTo: 'orders-table' }) }),
    'journeys.json': journeys(OPEN_AND_ESCAPE),
  })
  assert.equal(report.status, 'fail')
  assert.equal(code, 1)
  const finding = report.findings.find((entry) => entry.ruleId === 'focus-not-restored')
  assert.ok(finding !== undefined)
  assert.match(finding.message, /strands a keyboard user/)
  assert.equal(finding.location.pointer, '/journeys/0/steps/4')
})

test('a capture that does not say where focus returns is undetermined, not a restored focus and not a lost one', async () => {
  const { code, report } = await reportFor({
    'controls.json': capture({ controls: dialogControls(), regions: dialogRegion({ restoresFocusTo: undefined }) }),
    'journeys.json': journeys(OPEN_AND_ESCAPE),
  })
  assert.equal(report.status, 'incomplete')
  assert.equal(code, 2)
  assert.equal(report.summary.errors, 0)
  assert.ok(ruleIds(report).includes('focus-return-not-declared'))
  assert.ok(ruleIds(report).includes('focus-undetermined'))
  assert.ok(!ruleIds(report).includes('focus-not-restored'))
  assert.ok(!ruleIds(report).includes('focus-mismatch'))
  const finding = report.findings.find((entry) => entry.ruleId === 'focus-return-not-declared')
  assert.match(finding.message, /It is not therefore left where it was/)
  assert.equal(report.journeys[0].endsFocusDetermined, false)
})

test('a journey that opens a dialog and never closes it does not demonstrate the close path', async () => {
  const { code, report } = await reportFor({
    'controls.json': capture({ controls: dialogControls(), regions: dialogRegion() }),
    'journeys.json': journeys([{
      id: 'open-only',
      steps: [{ press: 'Enter', on: 'open-dialog' }, { expectFocus: 'confirm-cancel' }],
    }]),
  })
  assert.equal(code, 1)
  const finding = report.findings.find((entry) => entry.ruleId === 'region-left-open')
  assert.ok(finding !== undefined)
  assert.deepEqual(report.journeys[0].regionsLeftOpen, ['confirm'])
})

test('a pointer-only interaction fails its keyboard contract', async () => {
  const { code, report } = await reportFor({
    'controls.json': capture({ controls: dialogControls({ activatedBy: ['pointer'] }), regions: dialogRegion() }),
    'journeys.json': journeys([{ id: 'open-it', steps: [{ tabTo: 'open-dialog' }, { press: 'Enter', on: 'open-dialog' }] }]),
  })
  assert.equal(report.status, 'fail')
  assert.equal(code, 1)
  const finding = report.findings.find((entry) => entry.ruleId === 'pointer-only-activation')
  assert.ok(finding !== undefined)
  assert.match(finding.message, /which did observe activation/)
  assert.match(finding.message, /does not meet its keyboard contract/)
  assert.equal(finding.evidence, 'activatedBy: pointer')
})

test('a capture that records nothing at all as activating a control does not get called pointer-only', async () => {
  const { code, report } = await reportFor({
    'controls.json': capture({ controls: dialogControls({ activatedBy: [] }), regions: dialogRegion() }),
    'journeys.json': journeys([{ id: 'open-it', steps: [{ press: 'Enter', on: 'open-dialog' }] }]),
  })
  assert.equal(code, 1)
  const finding = report.findings.find((entry) => entry.ruleId === 'pointer-only-activation')
  assert.ok(finding !== undefined)
  assert.match(finding.message, /records nothing at all as activating it/)
  assert.ok(!finding.message.includes('pointer only'), 'the report claimed a pointer works, which this capture does not say')
  assert.equal(finding.evidence, 'activatedBy: (empty)')
})

test('the identical pointer-only journey is undetermined when the capture never tried the keys', async () => {
  const { code, report } = await reportFor({
    'controls.json': capture({ controls: dialogControls({ activatedBy: ['pointer'] }), regions: dialogRegion(), activationObserved: false }),
    'journeys.json': journeys([{ id: 'open-it', steps: [{ tabTo: 'open-dialog' }, { press: 'Enter', on: 'open-dialog' }] }]),
  })
  assert.equal(report.status, 'incomplete')
  assert.equal(code, 2)
  assert.equal(report.summary.errors, 0)
  assert.ok(!ruleIds(report).includes('pointer-only-activation'))
  const finding = report.findings.find((entry) => entry.ruleId === 'activation-undetermined')
  assert.match(finding.message, /what somebody happened to try -- not what does and does not work/)
  assert.equal(report.summary.activationObserved, false)
})

test('a capture with no activatedBy at all is undetermined, never pointer-only', async () => {
  const controls = dialogControls()
  delete controls[1].activatedBy
  const { code, report } = await reportFor({
    'controls.json': capture({ controls, regions: dialogRegion() }),
    'journeys.json': journeys([{ id: 'open-it', steps: [{ press: 'Enter', on: 'open-dialog' }] }]),
  })
  assert.equal(code, 2)
  assert.equal(report.summary.errors, 0)
  assert.ok(!ruleIds(report).includes('pointer-only-activation'))
  const finding = report.findings.find((entry) => entry.ruleId === 'activation-undetermined')
  assert.match(finding.message, /Not recorded is not the same as not working/)
})

test('a control that takes some keys but not this one is reported as that, not as pointer-only', async () => {
  const { code, report } = await reportFor({
    'controls.json': capture({ controls: dialogControls({ activatedBy: ['Enter', 'pointer'] }), regions: dialogRegion() }),
    'journeys.json': journeys([{ id: 'open-it', steps: [{ press: 'Space', on: 'open-dialog' }] }]),
  })
  assert.equal(code, 1)
  assert.ok(ruleIds(report).includes('key-not-activating'))
  assert.ok(!ruleIds(report).includes('pointer-only-activation'))
})

test('a control that takes the key the journey uses raises nothing at all', async () => {
  const { code, report } = await reportFor({
    'controls.json': capture({ controls: dialogControls({ activatedBy: ['Enter', 'pointer'] }), regions: dialogRegion() }),
    'journeys.json': journeys(OPEN_AND_ESCAPE),
  })
  assert.equal(code, 0)
  assert.deepEqual(report.findings, [])
})

test('no report this tool can produce claims a browser was driven or a screen reader emulated', async () => {
  // The word scan used to run over ONE report, from a capture that passes with
  // zero findings. Every message string this tool can emit lives in a finding,
  // so that scan could never see one: it was an assertion that could not fail.
  // These three reports between them carry an error-severity finding, a
  // limitation finding and none at all, and the count below refuses to let the
  // scan go quiet again.
  const passing = await reportFor({
    'controls.json': capture({ controls: dialogControls({ activatedBy: ['Enter', 'pointer'] }), regions: dialogRegion() }),
    'journeys.json': journeys(OPEN_AND_ESCAPE),
  })
  const failing = await reportFor({
    'controls.json': capture({ controls: dialogControls({ activatedBy: ['pointer'] }), regions: dialogRegion() }),
    'journeys.json': journeys(OPEN_AND_ESCAPE),
  })
  const incomplete = await reportFor({
    'controls.json': capture({
      controls: dialogControls({ activatedBy: ['pointer'] }),
      regions: dialogRegion({ restoresFocusTo: null, initialFocus: null, dismissKeys: null, modal: null }),
      activationObserved: false,
    }),
    'journeys.json': journeys([...OPEN_AND_ESCAPE, { id: 'nowhere', steps: [{ tabTo: 'no-such-control' }] }]),
  })
  assert.deepEqual([passing.code, failing.code, incomplete.code], [0, 1, 2])
  assert.equal(passing.report.findings.length, 0)

  let messages = 0
  for (const { report } of [passing, failing, incomplete]) {
    assert.equal(report.summary.browserDriven, false)
    assert.equal(report.summary.keysPressed, 0)
    assert.equal(report.summary.screenReaderEmulated, false)
    assert.equal(report.summary.evidence, 'declared-capture')
    const serialized = JSON.stringify(report)
    for (const word of ['announce', 'spoken', 'screen reader said', 'verified', 'confirmed that']) {
      assert.ok(!serialized.toLowerCase().includes(word), `the report claims "${word}"`)
    }
    messages += report.findings.length
  }
  assert.ok(messages >= 6, `only ${messages} finding message(s) were scanned, so the scan is close to vacuous`)
})

test('the human summary says what was not done, on every run', async () => {
  const root = await makeRoot({
    'controls.json': capture({ controls: dialogControls(), regions: dialogRegion() }),
    'journeys.json': journeys(OPEN_AND_ESCAPE),
  })
  try {
    const { code, stderr } = await runCli(['--root', root])
    assert.equal(code, 0)
    assert.match(stderr, /no browser was driven, no key was pressed, no focus was observed and no screen reader was emulated/)
  } finally {
    await removeRoot(root)
  }
})

test('a capture that does not claim activation was observed says so on stderr', async () => {
  const root = await makeRoot({
    'controls.json': capture({ controls: dialogControls(), regions: dialogRegion(), activationObserved: false }),
    'journeys.json': journeys(OPEN_AND_ESCAPE),
  })
  try {
    const { code, stderr } = await runCli(['--root', root])
    assert.equal(code, 2)
    assert.match(stderr, /does not claim activation was observed, so no key was judged to fail on it/)
  } finally {
    await removeRoot(root)
  }
})
