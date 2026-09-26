/**
 * The package ships what it says it ships, and says nothing it should not.
 */

import { access, readFile, readdir } from 'node:fs/promises'
import { basename, join } from 'node:path'
import assert from 'node:assert/strict'
import test from 'node:test'

import { REPORT_SCHEMA_VERSION, TOOL_ID } from '../src/index.mjs'
import { PACKAGE_ROOT, runCli } from './support.mjs'

async function manifest() {
  return JSON.parse(await readFile(join(PACKAGE_ROOT, 'package.json'), 'utf8'))
}

test('TOOL_ID equals the directory name and the package name', async () => {
  assert.equal(TOOL_ID, basename(PACKAGE_ROOT))
  assert.equal(TOOL_ID, (await manifest()).name)
  assert.equal(TOOL_ID, 'keyboard-path-checker')
})

test('the report envelope carries the tool id and the schema version', async () => {
  const { stdout } = await runCli(['--root', 'examples/restores-focus', '--json'], { cwd: PACKAGE_ROOT })
  const report = JSON.parse(stdout)
  assert.equal(report.tool, TOOL_ID)
  assert.equal(report.schemaVersion, REPORT_SCHEMA_VERSION)
  for (const key of ['schemaVersion', 'tool', 'status', 'summary', 'findings']) {
    assert.ok(Object.hasOwn(report, key), key)
  }
  for (const key of ['checked', 'errors', 'warnings']) {
    assert.equal(typeof report.summary[key], 'number', key)
  }
})

test('the scripts the build requires are all present', async () => {
  const { scripts } = await manifest()
  for (const name of ['lint', 'test', 'check', 'example', 'example:failing', 'example:incomplete', 'pack:check']) {
    assert.ok(typeof scripts[name] === 'string' && scripts[name].length > 0, name)
  }
  assert.match(scripts.check, /npm run lint/)
  assert.match(scripts.check, /npm test/)
  assert.match(scripts.check, /npm run example/)
  assert.match(scripts.check, /pack:check/)
})

test('the bin entry exists and is the CLI', async () => {
  const { bin } = await manifest()
  assert.deepEqual(Object.keys(bin), [TOOL_ID])
  await access(join(PACKAGE_ROOT, bin[TOOL_ID]))
})

test('every path in files exists', async () => {
  const { files } = await manifest()
  for (const entry of files) await access(join(PACKAGE_ROOT, entry))
})

test('no source, document or fixture carries an authorship line this build forbids', async () => {
  const forbidden = [/Co-Authored-By/i, /Co-authored-by/, /\bAnthropic\b/, /\bClaude\b/, /\bOpus\b/]
  const roots = ['src', 'bin', 'test', 'docs', 'examples/restores-focus', 'examples/pointer-only', 'examples/unobserved']
  const checked = []
  for (const directory of roots) {
    for (const name of await readdir(join(PACKAGE_ROOT, directory))) {
      // This file is excluded from its own scan: the patterns above are its
      // source text. A guard must scan the input, not its own rendering of it.
      if (name === 'package.test.mjs') continue
      checked.push(join(PACKAGE_ROOT, directory, name))
    }
  }
  checked.push(join(PACKAGE_ROOT, 'README.md'), join(PACKAGE_ROOT, 'CHANGELOG.md'), join(PACKAGE_ROOT, 'package.json'))
  assert.ok(checked.length >= 25, 'the scan found almost nothing, so it cannot fail')
  for (const file of checked) {
    let text
    try {
      text = await readFile(file, 'utf8')
    } catch {
      continue
    }
    for (const pattern of forbidden) {
      assert.ok(!pattern.test(text), `${file} matches ${pattern}`)
    }
  }
})
