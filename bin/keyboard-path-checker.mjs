#!/usr/bin/env node

import process from 'node:process'

import {
  DEFAULT_CAPTURE_NAME, DEFAULT_JOURNEYS_NAME,
  checkKeyboardPaths, excerpt, exitCodeFor, formatReport, serializeReport,
} from '../src/index.mjs'

const VERSION = '0.1.0'

const HELP = `keyboard-path-checker

Run declared keyboard journeys against a declared capture of a local fixture's
controls, and report where reachability, activation, dismissal or focus return
does not hold.

NO BROWSER IS OPENED AND NO KEY IS PRESSED. This tool reads two local JSON
documents and runs a state machine over them. It does not drive a page, does
not press Tab or Enter or Escape, does not observe focus and does not emulate a
screen reader. The report says so: evidence is "declared-capture", keysPressed
is 0, and browserDriven and screenReaderEmulated are false in every report this
tool can produce.

The distinction the whole tool turns on:
  the capture SAYS what happens -- the journey matches it or it does not, and
  that is a pass or a fail;
  the capture does NOT say -- focus becomes undetermined, the region stack
  becomes undetermined with it, neither is compared against an expectation, and
  the run is incomplete. Incomplete exits 2 and is never a pass.

That is why capture.activationObserved exists. A capture that did not really
try each key has an activatedBy list of what somebody happened to press, not of
what works, so a key missing from it falsifies nothing -- and this tool will not
say it does.

What this tool never claims:
  that a control was announced, or how. Reaching and activating a control says
  nothing about what a screen reader said; that needs separate manual evidence.

Usage:
  keyboard-path-checker --root DIR [--capture FILE] [--journeys FILE]
                        [--json] [limits]

Options:
  --root DIR                 Directory holding both documents (required)
  --capture FILE             Control capture, relative to --root
                             (default ${DEFAULT_CAPTURE_NAME})
  --journeys FILE            Declared journeys, relative to --root
                             (default ${DEFAULT_JOURNEYS_NAME})
  --json                     Suppress the human summary on stderr

Limits (documents that could not be read completely, reported):
  --max-controls N           Maximum controls in one capture (default 2000)
  --max-document-bytes N     Maximum size of either document (default 1048576)
  --max-findings N           Maximum findings in one report (default 1000)
  --max-journeys N           Maximum journeys in one document (default 200)
  --max-runtime-ms N         Time budget, checked between journeys. Not a hard
                             deadline: a run overshoots by the cost of the
                             journey in hand (default 10000)
  --max-steps-per-journey N  Maximum steps in one journey (default 200)
  -h, --help                 Show this help
  -v, --version              Show the version

Every option that carries a value may be given once: a repeated flag is a
configuration error, not a silent last-wins. An unknown option is refused.

This tool writes nothing. It has no --out, creates no directory and modifies no
file, so no destination check applies to it.

Output:
  stdout  the JSON report only, so it can be piped straight into a parser
  stderr  the human summary and diagnostics

Where the line falls between exit 1 and exit 2:
  A journey that contradicts a capture both of which were read completely is a
  fact ABOUT them, and it fails (exit 1). Evidence this tool could not obtain --
  an unreadable document, a control the capture does not describe, an
  activation nobody observed, a region that does not declare where focus goes --
  is incomplete (exit 2), never a pass, and never reported as absence.

Exit codes:
  0  both documents were read in full and no error-severity rule fired
  1  both documents were read in full and at least one error-severity rule fired
  2  invalid configuration (no report on stdout), or evidence that could not be
     obtained (an "incomplete" report on stdout, never a "pass")
`

const LIMIT_FLAGS = new Map([
  ['--max-controls', 'maxControls'],
  ['--max-document-bytes', 'maxDocumentBytes'],
  ['--max-findings', 'maxFindings'],
  ['--max-journeys', 'maxJourneys'],
  ['--max-runtime-ms', 'maxRuntimeMs'],
  ['--max-steps-per-journey', 'maxStepsPerJourney'],
])

const VALUE_FLAGS = new Map([
  ['--capture', 'capture'],
  ['--journeys', 'journeys'],
  ['--root', 'root'],
])

function parseArguments(argv) {
  if (argv.includes('-h') || argv.includes('--help')) return { help: true }
  if (argv.includes('-v') || argv.includes('--version')) return { version: true }

  const options = { root: null, capture: null, journeys: null, json: false, limits: {} }
  const given = new Set()

  /**
   * A flag carrying a value is accepted once. Letting it repeat discards the
   * earlier value with no diagnostic, so `--max-journeys 2 --max-journeys 900`
   * would read a document against a limit nobody asked for.
   */
  const once = (name) => {
    if (given.has(name)) throw new Error(`${name} was given more than once`)
    given.add(name)
  }

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    const takeValue = (name) => {
      const value = argv[index + 1]
      if (value === undefined || value.startsWith('-')) throw new Error(`${name} requires a value`)
      index += 1
      return value
    }

    if (argument === '--json') {
      once(argument)
      options.json = true
    } else if (VALUE_FLAGS.has(argument)) {
      once(argument)
      options[VALUE_FLAGS.get(argument)] = takeValue(argument)
    } else if (LIMIT_FLAGS.has(argument)) {
      once(argument)
      const raw = takeValue(argument)
      if (!/^\d+$/.test(raw) || Number(raw) < 1) throw new Error(`${argument} requires a positive integer`)
      options.limits[LIMIT_FLAGS.get(argument)] = Number(raw)
    // argv is the one untrusted string that reaches a stream without passing
    // through a finding, so it is flattened exactly as a finding would be.
    } else throw new Error(`Unknown option "${excerpt(argument, 60)}"`)
  }

  if (options.root === null) throw new Error('--root is required')
  return options
}

async function main(argv) {
  let options
  try {
    options = parseArguments(argv)
  } catch (error) {
    process.stderr.write(`${error.message}\n\n${HELP}`)
    return 2
  }
  if (options.help) {
    process.stdout.write(HELP)
    return 0
  }
  if (options.version) {
    process.stdout.write(`${VERSION}\n`)
    return 0
  }

  let report
  try {
    report = await checkKeyboardPaths({
      root: options.root,
      limits: options.limits,
      ...(options.capture === null ? {} : { capture: options.capture }),
      ...(options.journeys === null ? {} : { journeys: options.journeys }),
    })
  } catch (error) {
    // A configuration error means the run never had a subject, so stdout stays
    // empty rather than carrying a fabricated report.
    process.stderr.write(`${excerpt(error.message, 400)}\n`)
    return 2
  }

  process.stdout.write(`${serializeReport(report)}\n`)
  if (!options.json) process.stderr.write(formatReport(report))
  if (report.status === 'incomplete') {
    process.stderr.write('incomplete: this run is not a pass. Part of the journey was never checked.\n')
  }
  return exitCodeFor(report)
}

process.exitCode = await main(process.argv.slice(2))
