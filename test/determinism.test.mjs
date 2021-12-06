/**
 * Byte-identical output over identical documents.
 *
 * Nothing in this tool reads a wall clock, so there is no timestamp to vary and
 * no `--now` to inject. The one clock it does read is monotonic and feeds the
 * time budget only; a run that does not reach the budget cannot observe it.
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  OPEN_AND_ESCAPE, capture, dialogControls, dialogRegion, journeys, makeRoot, removeRoot, runCli,
} from './support.mjs'

const FILES = {
  'controls.json': capture({ controls: dialogControls(), regions: dialogRegion() }),
  'journeys.json': journeys(OPEN_AND_ESCAPE),
}

test('two runs over identical documents produce byte-identical stdout', async () => {
  const root = await makeRoot(FILES)
  try {
    const first = await runCli(['--root', root, '--json'])
    const second = await runCli(['--root', root, '--json'])
    assert.equal(first.code, second.code)
    assert.equal(first.stdout, second.stdout)
    assert.ok(first.stdout.length > 0)
  } finally {
    await removeRoot(root)
  }
})

test('the report carries no timestamp, so nothing in it can depend on when it ran', async () => {
  const root = await makeRoot(FILES)
  try {
    const { stdout } = await runCli(['--root', root, '--json'])
    assert.ok(!/\d{4}-\d{2}-\d{2}T/.test(stdout), 'an ISO instant appeared in the report')
    assert.ok(!Object.hasOwn(JSON.parse(stdout).summary, 'evaluatedAt'))
  } finally {
    await removeRoot(root)
  }
})

test('stdout is the JSON report and nothing else, so it pipes straight into a parser', async () => {
  const root = await makeRoot(FILES)
  try {
    const { stdout } = await runCli(['--root', root])
    const report = JSON.parse(stdout)
    assert.equal(report.tool, 'keyboard-path-checker')
    assert.equal(report.schemaVersion, '1')
  } finally {
    await removeRoot(root)
  }
})
