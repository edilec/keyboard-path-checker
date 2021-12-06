/**
 * Every documented limit is enforced, and the clock is injected rather than
 * read.
 *
 * A documented limit that is never wired up is a defect this catalog has
 * shipped before: a config key accepted and silently ignored because the CLI
 * never threaded a clock through. So the time budget here is driven by an
 * injected monotonic, not by making the test slow.
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { DEFAULT_LIMITS, HARD_LIMITS, checkKeyboardPaths, validateLimits } from '../src/index.mjs'
import { capture, dialogControls, dialogRegion, journeys, makeRoot, removeRoot } from './support.mjs'

const FILES = {
  'controls.json': capture({ controls: dialogControls(), regions: dialogRegion() }),
  'journeys.json': journeys([
    { id: 'first', steps: [{ tabTo: 'orders-table' }] },
    { id: 'second', steps: [{ tabTo: 'orders-table' }] },
  ]),
}

async function withRoot(body, files = FILES) {
  const root = await makeRoot(files)
  try {
    return await body(root)
  } finally {
    await removeRoot(root)
  }
}

test('an unknown limit key is refused, because a one-character typo must not switch a check off', () => {
  assert.throws(() => validateLimits({ maxJourney: 5 }), /Unknown limit "maxJourney"/)
  assert.throws(() => validateLimits({ maxjourneys: 5 }), /Unknown limit "maxjourneys"/)
})

test('a limit outside its range is refused', () => {
  for (const key of Object.keys(DEFAULT_LIMITS)) {
    assert.throws(() => validateLimits({ [key]: 0 }), new RegExp(`limits\\.${key} must be an integer`))
    assert.throws(() => validateLimits({ [key]: HARD_LIMITS[key] + 1 }), new RegExp(`limits\\.${key} must be an integer`))
    assert.throws(() => validateLimits({ [key]: 1.5 }), new RegExp(`limits\\.${key} must be an integer`))
  }
})

test('every default is at or below its cap, so the defaults are themselves valid', () => {
  for (const [key, value] of Object.entries(DEFAULT_LIMITS)) {
    assert.ok(value >= 1 && value <= HARD_LIMITS[key], key)
  }
  assert.deepEqual(Object.keys(DEFAULT_LIMITS).sort(), Object.keys(HARD_LIMITS).sort())
})

test('an unknown option to the library is refused rather than ignored', async () => {
  await withRoot(async (root) => {
    await assert.rejects(() => checkKeyboardPaths({ root, captures: 'controls.json' }), /Unknown option "captures"/)
    await assert.rejects(() => checkKeyboardPaths({ root, Journeys: 'x' }), /Unknown option "Journeys"/)
  })
})

test('the time budget is driven by an injected clock, and expiring it is incomplete -- not a document with no journeys left', async () => {
  await withRoot(async (root) => {
    let call = 0
    const report = await checkKeyboardPaths({
      root,
      limits: { maxRuntimeMs: 5 },
      // First call establishes the start; every later call is past the budget.
      monotonic: () => (call++ === 0 ? 0 : 1000),
    })
    const finding = report.findings.find((entry) => entry.ruleId === 'time-budget-exceeded')
    assert.ok(finding !== undefined, JSON.stringify(report.findings))
    assert.match(finding.message, /is not a document whose remaining journeys hold/)
    assert.equal(report.status, 'incomplete')
    assert.equal(report.summary.journeysRun, 0)
  })
})

test('a monotonic that never advances leaves the budget unspent', async () => {
  await withRoot(async (root) => {
    const report = await checkKeyboardPaths({ root, limits: { maxRuntimeMs: 5 }, monotonic: () => 0 })
    assert.equal(report.status, 'pass')
    assert.deepEqual(report.findings, [])
    assert.equal(report.summary.journeysRun, 2)
  })
})

test('monotonic must be a function, and root must be a usable directory', async () => {
  await withRoot(async (root) => {
    await assert.rejects(() => checkKeyboardPaths({ root, monotonic: 7 }), /monotonic must be a function/)
  })
  await assert.rejects(() => checkKeyboardPaths({ root: '' }), /root must be a non-empty string/)
  await assert.rejects(() => checkKeyboardPaths({ root: '/no/such/directory/anywhere' }), /is not a directory this run can read/)
})

test('each limit names itself and its value in the finding it raises', async () => {
  const cases = [
    { limits: { maxControls: 1 }, rule: 'too-many-controls', text: /maxControls limit of 1/ },
    { limits: { maxJourneys: 1 }, rule: 'too-many-journeys', text: /maxJourneys limit of 1/ },
    { limits: { maxDocumentBytes: 10 }, rule: 'input-too-large', text: /maxDocumentBytes limit of 10/ },
    { limits: { maxStepsPerJourney: 1 }, rule: 'too-many-steps', text: /maxStepsPerJourney limit of 1/ },
    { limits: { maxFindings: 1 }, rule: 'too-many-findings', text: /maxFindings limit of 1/ },
  ]
  await withRoot(async (root) => {
    for (const { limits, rule, text } of cases) {
      const report = await checkKeyboardPaths({ root, limits })
      const finding = report.findings.find((entry) => entry.ruleId === rule)
      assert.ok(finding !== undefined, `${rule}: ${JSON.stringify(report.findings.map((f) => f.ruleId))}`)
      assert.match(finding.message, text)
      assert.equal(report.status, 'incomplete', rule)
    }
  }, {
    'controls.json': capture({ controls: dialogControls(), regions: dialogRegion() }),
    'journeys.json': journeys([
      { id: 'first', steps: [{ tabTo: 'nowhere' }, { tabTo: 'nowhere-else' }] },
      { id: 'second', steps: [{ tabTo: 'nowhere' }] },
    ]),
  })
})
