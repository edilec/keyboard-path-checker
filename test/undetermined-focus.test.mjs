/**
 * The invariant the whole tool turns on, pinned at every place that can break
 * it: once focus is undetermined it is never compared against an expectation --
 * not as a match and not as a mismatch.
 *
 * Every case below is one call site of `unknownFocus`. Each is driven twice
 * from the same capture:
 *
 * - `expectFocus` naming a control focus was NOT on before the step. If the
 *   site stops recording the undetermined focus, the stale focus is compared
 *   and the run reports `focus-mismatch` -- an error-severity claim about a
 *   page this capture says nothing about.
 * - `expectFocus` naming the control focus WAS on before the step. There the
 *   stale comparison matches, so the report simply loses the sentence saying
 *   nothing was compared, and the step passes on evidence that is not there.
 *
 * Both directions matter, and the second is the one a single "no mismatch"
 * assertion misses. Neutralising any one of these assignments -- to
 * `focus = focus || unknownFocus(...)`, which is a no-op because focus is
 * always an object -- fails the case that names it.
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { capture, journeys, reportFor, ruleIds } from './support.mjs'

/**
 * `here` is where focus sits before the undetermined step, `steps` is the walk
 * that reaches that step, and `rule` is the finding that records the gap.
 */
const SITES = [
  {
    why: 'a step naming a control the capture does not describe',
    rule: 'control-undeclared',
    controls: [{ ref: 'here', tabbable: true, activatedBy: ['Enter'] }],
    regions: [],
    steps: [{ tabTo: 'here' }, { tabTo: 'undescribed' }],
  },
  {
    why: 'a control whose tabbable the capture does not state',
    rule: 'tabbable-undetermined',
    controls: [{ ref: 'here', tabbable: true, activatedBy: ['Enter'] },
      { ref: 'quiet', activatedBy: ['Enter'] }],
    regions: [],
    steps: [{ tabTo: 'here' }, { tabTo: 'quiet' }],
  },
  {
    why: 'a control the capture records as not reachable by Tab',
    rule: 'control-not-reachable',
    controls: [{ ref: 'here', tabbable: true, activatedBy: ['Enter'] },
      { ref: 'unreachable', tabbable: false, activatedBy: ['Enter'] }],
    regions: [],
    steps: [{ tabTo: 'here' }, { tabTo: 'unreachable' }],
  },
  {
    why: 'a control whose activatedBy the capture does not record',
    rule: 'activation-undetermined',
    controls: [{ ref: 'here', tabbable: true, activatedBy: ['Enter'] },
      { ref: 'silent', tabbable: true }],
    regions: [],
    steps: [{ tabTo: 'here' }, { press: 'Enter', on: 'silent' }],
  },
  {
    why: 'a capture that did not observe activation',
    rule: 'activation-undetermined',
    activationObserved: false,
    controls: [{ ref: 'here', tabbable: true, activatedBy: ['Enter'] }],
    regions: [],
    steps: [{ tabTo: 'here' }, { press: 'Enter', on: 'here' }],
  },
  {
    why: 'a control opening a region the capture does not describe',
    rule: 'region-undeclared',
    controls: [{ ref: 'here', tabbable: true, activatedBy: ['Enter'] },
      { ref: 'opener', tabbable: true, activatedBy: ['Enter'], opens: 'nowhere' }],
    regions: [],
    steps: [{ tabTo: 'here' }, { press: 'Enter', on: 'opener' }],
  },
  {
    why: 'a region that declares no initialFocus',
    rule: 'region-without-initial-focus',
    controls: [{ ref: 'here', tabbable: true, activatedBy: ['Enter'] },
      { ref: 'opener', tabbable: true, activatedBy: ['Enter'], opens: 'panel' }],
    regions: [{ ref: 'panel', modal: false, dismissKeys: ['Escape'], restoresFocusTo: 'opener' }],
    steps: [{ tabTo: 'here' }, { press: 'Enter', on: 'opener' }],
  },
  {
    why: 'a region that declares no restoresFocusTo',
    rule: 'focus-return-not-declared',
    controls: [{ ref: 'here', tabbable: true, activatedBy: ['Enter'], opens: 'panel' },
      { ref: 'inside', tabbable: true, activatedBy: ['Enter'], region: 'panel' }],
    regions: [{ ref: 'panel', modal: false, dismissKeys: ['Escape'], initialFocus: 'here' }],
    steps: [{ tabTo: 'here' }, { press: 'Enter', on: 'here' }, { press: 'Escape' }],
  },
  {
    why: 'a region whose dismissKeys the capture does not declare',
    rule: 'dismiss-keys-not-declared',
    controls: [{ ref: 'here', tabbable: true, activatedBy: ['Enter'], opens: 'panel' },
      { ref: 'inside', tabbable: true, activatedBy: ['Enter'], region: 'panel' }],
    regions: [{ ref: 'panel', modal: false, initialFocus: 'here', restoresFocusTo: 'here' }],
    steps: [{ tabTo: 'here' }, { press: 'Enter', on: 'here' }, { press: 'Escape' }],
  },
  {
    why: 'a step dismissing a region that is not the innermost open one',
    rule: 'dismiss-wrong-region',
    controls: [{ ref: 'here', tabbable: true, activatedBy: ['Enter'] },
      { ref: 'closer', tabbable: true, activatedBy: ['Enter'], dismisses: 'panel' }],
    regions: [{ ref: 'panel', modal: false, dismissKeys: ['Escape'], initialFocus: 'here', restoresFocusTo: 'here' }],
    steps: [{ tabTo: 'here' }, { press: 'Enter', on: 'closer' }],
  },
  {
    why: 'a region whose modal the capture never declares',
    rule: 'modal-not-declared',
    controls: [{ ref: 'here', tabbable: true, activatedBy: ['Enter'], opens: 'panel' },
      { ref: 'outside', tabbable: true, activatedBy: ['Enter'] },
      { ref: 'inside', tabbable: true, activatedBy: ['Enter'], region: 'panel' }],
    regions: [{ ref: 'panel', dismissKeys: ['Escape'], initialFocus: 'here', restoresFocusTo: 'here' }],
    steps: [{ tabTo: 'here' }, { press: 'Enter', on: 'here' }, { tabTo: 'outside' }],
  },
  {
    why: 'a control behind an open modal region',
    rule: 'unreachable-behind-modal',
    controls: [{ ref: 'here', tabbable: true, activatedBy: ['Enter'], opens: 'panel' },
      { ref: 'outside', tabbable: true, activatedBy: ['Enter'] },
      { ref: 'inside', tabbable: true, activatedBy: ['Enter'], region: 'panel' }],
    regions: [{ ref: 'panel', modal: true, dismissKeys: ['Escape'], initialFocus: 'here', restoresFocusTo: 'here' }],
    steps: [{ tabTo: 'here' }, { press: 'Enter', on: 'here' }, { tabTo: 'outside' }],
  },
]

const ELSEWHERE = { ref: 'elsewhere', tabbable: true, activatedBy: ['Enter'] }

function documents(site, expected) {
  return {
    'controls.json': capture({
      controls: [...site.controls, ELSEWHERE],
      regions: site.regions,
      activationObserved: site.activationObserved ?? true,
    }),
    'journeys.json': journeys([{ id: 'j', steps: [...site.steps, { expectFocus: expected }] }]),
  }
}

for (const site of SITES) {
  test(`focus left undetermined by ${site.why} is never compared as a mismatch`, async () => {
    const { code, report } = await reportFor(documents(site, 'elsewhere'))
    const rules = ruleIds(report)
    assert.ok(rules.includes(site.rule), `expected ${site.rule}, got ${rules.join(', ')}`)
    assert.ok(rules.includes('focus-undetermined'), `nothing recorded that focus was undetermined: ${rules.join(', ')}`)
    assert.ok(!rules.includes('focus-mismatch'), 'an undetermined focus was compared and called a mismatch')
    assert.ok(!rules.includes('focus-not-restored'), 'an undetermined focus was compared and called a lost focus')
    assert.equal(report.status, 'incomplete')
    assert.equal(code, 2)
    assert.equal(report.journeys[0].complete, false)
    assert.equal(report.journeys[0].endsFocusDetermined, false)
    assert.equal(report.journeys[0].endsFocusedOn, null)
  })

  test(`focus left undetermined by ${site.why} is never compared as a match either`, async () => {
    // The stale focus this expectation names is exactly where the walk had got
    // to, so a comparison against it SUCCEEDS silently. Only the presence of
    // focus-undetermined distinguishes "nothing was compared" from "it matched".
    const { code, report } = await reportFor(documents(site, 'here'))
    const rules = ruleIds(report)
    assert.ok(rules.includes('focus-undetermined'), `the step passed on evidence that is not there: ${rules.join(', ')}`)
    assert.equal(report.status, 'incomplete')
    assert.equal(code, 2)
  })
}

test('the site list covers a distinct rule set, so none of the cases above is a duplicate of another', () => {
  assert.equal(new Set(SITES.map((site) => site.why)).size, SITES.length)
  assert.ok(new Set(SITES.map((site) => site.rule)).size >= 10)
})
