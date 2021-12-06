/**
 * No network, anywhere, at any time -- including in the tests.
 *
 * This is a source scan and it is deliberately narrow: it proves no module in
 * this package names a way to open a socket. A tool that reads two local files
 * has no reason to.
 */

import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import test from 'node:test'

import { PACKAGE_ROOT } from './support.mjs'

const FORBIDDEN = [
  'node:http', 'node:https', 'node:net', 'node:dns', 'node:tls', 'node:dgram',
  "'http'", "'https'", "'net'", "'dns'", "'tls'",
  'fetch(', 'XMLHttpRequest', 'WebSocket', 'undici',
]

async function sources() {
  const files = []
  for (const directory of ['src', 'bin', 'test']) {
    for (const name of await readdir(join(PACKAGE_ROOT, directory))) {
      // This file is excluded from its own scan: the needles below are its
      // source text. A guard must scan the input, not its own rendering of it.
      if (name === 'no-network.test.mjs') continue
      if (name.endsWith('.mjs')) files.push(join(PACKAGE_ROOT, directory, name))
    }
  }
  return files
}

test('no module in this package names a network primitive', async () => {
  const files = await sources()
  assert.ok(files.length >= 10, 'the scan found almost nothing, so it cannot fail')
  for (const file of files) {
    const text = await readFile(file, 'utf8')
    for (const needle of FORBIDDEN) {
      assert.ok(!text.includes(needle), `${file} names ${needle}`)
    }
  }
})

test('the package declares no dependencies of any kind', async () => {
  const manifest = JSON.parse(await readFile(join(PACKAGE_ROOT, 'package.json'), 'utf8'))
  assert.equal(manifest.dependencies, undefined)
  assert.equal(manifest.devDependencies, undefined)
  assert.equal(manifest.peerDependencies, undefined)
  assert.equal(manifest.optionalDependencies, undefined)
})

test('every import in src and bin resolves to a node: builtin or a file in this package', async () => {
  const files = await sources()
  const specifier = /from\s+'([^']+)'/g
  for (const file of files) {
    const text = await readFile(file, 'utf8')
    for (const match of text.matchAll(specifier)) {
      const target = match[1]
      assert.ok(
        target.startsWith('node:') || target.startsWith('./') || target.startsWith('../'),
        `${file} imports ${target}`,
      )
    }
  }
})
