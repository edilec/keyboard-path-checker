import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const run = promisify(execFile)

const HERE = fileURLToPath(new URL('.', import.meta.url))
export const PACKAGE_ROOT = join(HERE, '..')
export const BIN = join(PACKAGE_ROOT, 'bin', 'keyboard-path-checker.mjs')

/** A throwaway root holding the given files. Removed by the caller. */
export async function makeRoot(files) {
  const directory = await mkdtemp(join(tmpdir(), 'keyboard-path-checker-'))
  for (const [name, content] of Object.entries(files)) {
    const target = join(directory, name)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, content, 'utf8')
  }
  return directory
}

export async function removeRoot(directory) {
  await rm(directory, { recursive: true, force: true })
}

/** Run the real CLI. Never throws for a non-zero exit: the code is the answer. */
export async function runCli(args, options = {}) {
  try {
    const { stdout, stderr } = await run(process.execPath, [BIN, ...args], { encoding: 'utf8', ...options })
    return { code: 0, stdout, stderr }
  } catch (error) {
    return { code: error.code ?? 1, stdout: error.stdout ?? '', stderr: error.stderr ?? '' }
  }
}

/** Run the CLI over a throwaway root and hand back the parsed report. */
export async function reportFor(files, extraArgs = []) {
  const root = await makeRoot(files)
  try {
    const result = await runCli(['--root', root, '--json', ...extraArgs])
    return { ...result, report: result.stdout.length === 0 ? null : JSON.parse(result.stdout), root }
  } finally {
    await removeRoot(root)
  }
}

export function ruleIds(report) {
  return report.findings.map((finding) => finding.ruleId)
}

/** A capture document. `activationObserved` defaults to true. */
export function capture({ controls = [], regions = [], activationObserved = true, meta } = {}) {
  const document = { schemaVersion: '1', controls, regions }
  if (meta !== null) {
    document.capture = meta ?? { method: 'manual keyboard walk', activationObserved }
  }
  return `${JSON.stringify(document, null, 2)}\n`
}

export function journeys(list) {
  return `${JSON.stringify({ schemaVersion: '1', journeys: list }, null, 2)}\n`
}

/** One control that opens a modal region, and the region's two controls. */
export function dialogControls({ activatedBy = ['Enter', 'Space', 'pointer'] } = {}) {
  return [
    { ref: 'orders-table', role: 'link', name: 'Order 4471-B', tabbable: true, activatedBy: ['Enter', 'pointer'] },
    { ref: 'open-dialog', role: 'button', name: 'Delete order', tabbable: true, activatedBy, opens: 'confirm' },
    { ref: 'confirm-cancel', role: 'button', name: 'Cancel', tabbable: true, activatedBy: ['Enter', 'Space', 'pointer'], dismisses: 'confirm', region: 'confirm' },
    { ref: 'confirm-ok', role: 'button', name: 'Delete', tabbable: true, activatedBy: ['Enter', 'Space', 'pointer'], region: 'confirm' },
  ]
}

export function dialogRegion(overrides = {}) {
  return [{
    ref: 'confirm',
    role: 'dialog',
    modal: true,
    dismissKeys: ['Escape'],
    initialFocus: 'confirm-cancel',
    restoresFocusTo: 'open-dialog',
    ...overrides,
  }]
}

export const OPEN_AND_ESCAPE = [{
  id: 'open-and-escape',
  steps: [
    { tabTo: 'open-dialog' },
    { press: 'Enter', on: 'open-dialog' },
    { expectFocus: 'confirm-cancel' },
    { press: 'Escape' },
    { expectFocus: 'open-dialog' },
  ],
}]
