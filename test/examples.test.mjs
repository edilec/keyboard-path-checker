/**
 * The examples in the README run, and they run at the exit codes the README
 * says they do. An example that has drifted is a documentation overclaim.
 *
 * The last two tests are the point of the set: `unobserved` is `pointer-only`
 * with one boolean the machine reads changed -- plus the prose that says how
 * the capture was made, which the machine never reads and which is proved here
 * to move no verdict -- and it must not produce the failure `pointer-only`
 * does.
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import test from 'node:test'

import { PACKAGE_ROOT, makeRoot, removeRoot, runCli } from './support.mjs'

test('examples/restores-focus passes, and both journeys end on the control that opened the dialog', async () => {
  const { code, stdout } = await runCli(['--root', 'examples/restores-focus', '--json'], { cwd: PACKAGE_ROOT })
  assert.equal(code, 0)
  const report = JSON.parse(stdout)
  assert.equal(report.status, 'pass')
  assert.deepEqual(report.findings, [])
  assert.deepEqual(report.journeys.map((entry) => entry.endsFocusedOn), ['delete-order', 'delete-order'])
})

test('examples/pointer-only fails on both acceptance criteria', async () => {
  const { code, stdout } = await runCli(['--root', 'examples/pointer-only', '--json'], { cwd: PACKAGE_ROOT })
  assert.equal(code, 1)
  const report = JSON.parse(stdout)
  assert.equal(report.status, 'fail')
  const rules = report.findings.map((finding) => finding.ruleId)
  assert.ok(rules.includes('pointer-only-activation'))
  assert.ok(rules.includes('focus-not-restored'))
})

test('examples/unobserved is incomplete with zero errors, which is the whole point of it', async () => {
  const { code, stdout } = await runCli(['--root', 'examples/unobserved', '--json'], { cwd: PACKAGE_ROOT })
  assert.equal(code, 2)
  const report = JSON.parse(stdout)
  assert.equal(report.status, 'incomplete')
  assert.equal(report.summary.errors, 0)
  assert.ok(report.summary.notEvaluated.includes('activation-undetermined'))
  assert.ok(!report.findings.some((finding) => finding.ruleId === 'pointer-only-activation'))
})

/** Every JSON Pointer at which two documents hold a different value. */
function differingPointers(left, right, prefix = '') {
  if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object'
    || Array.isArray(left) !== Array.isArray(right)) {
    return JSON.stringify(left) === JSON.stringify(right) ? [] : [prefix === '' ? '/' : prefix]
  }
  const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort()
  return keys.flatMap((key) => differingPointers(left[key], right[key], `${prefix}/${key.replace(/~/g, '~0').replace(/\//g, '~1')}`))
}

test('unobserved and pointer-only differ only in activationObserved and the prose describing the capture', async () => {
  // The name used to say "by exactly one field" and the body never compared
  // capture.method, which DOES differ: one says the keys were really pressed
  // and the other says they were not tried. The substantive claim -- that the
  // different verdict comes from the evidence rather than from a different
  // fixture -- is unchanged, so it is asserted here mechanically instead: the
  // full set of differing pointers, and then a run proving the second one
  // cannot be what moved the verdict.
  const read = async (directory, name) => JSON.parse(await readFile(join(PACKAGE_ROOT, 'examples', directory, name), 'utf8'))
  const strict = await read('pointer-only', 'controls.json')
  const loose = await read('unobserved', 'controls.json')
  assert.deepEqual(
    differingPointers(strict, loose),
    ['/capture/activationObserved', '/capture/method'],
  )
  assert.equal(strict.capture.activationObserved, true)
  assert.equal(loose.capture.activationObserved, false)
  assert.deepEqual(
    differingPointers(await read('unobserved', 'journeys.json'), await read('pointer-only', 'journeys.json')),
    [],
  )
})

test('the capture method is prose: changing it alone moves no verdict', async () => {
  // The second differing field, isolated. `method` is the document's own
  // account of how it was made; the machine checks its shape and reads it
  // nowhere, so pointer-only carrying unobserved's method must still fail
  // exactly as pointer-only does.
  const read = async (directory, name) => readFile(join(PACKAGE_ROOT, 'examples', directory, name), 'utf8')
  const strict = JSON.parse(await read('pointer-only', 'controls.json'))
  const loose = JSON.parse(await read('unobserved', 'controls.json'))
  const original = await runCli(['--root', 'examples/pointer-only', '--json'], { cwd: PACKAGE_ROOT })
  strict.capture.method = loose.capture.method
  const root = await makeRoot({
    'controls.json': `${JSON.stringify(strict, null, 2)}\n`,
    'journeys.json': await read('pointer-only', 'journeys.json'),
  })
  try {
    const swapped = await runCli(['--root', root, '--json'])
    assert.equal(swapped.code, original.code)
    assert.deepEqual(JSON.parse(swapped.stdout).findings, JSON.parse(original.stdout).findings)
  } finally {
    await removeRoot(root)
  }
})
