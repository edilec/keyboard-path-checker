# Keyboard Path Checker

Run declared keyboard journeys against a declared capture of a local fixture's
controls -- reachability, activation, dismissal and focus return -- and report
what the capture could not tell it rather than passing on silence.

- **Repository:** [edilec/keyboard-path-checker](https://github.com/edilec/keyboard-path-checker)
- **Area:** Accessibility
- **License:** MIT

## No browser is opened and no key is pressed

This tool reads two local JSON documents and runs a state machine over them. It
does not drive a page, does not press Tab or Enter or Escape, does not observe
focus and does not emulate a screen reader. The input is **evidence somebody
exported**: a capture of a fixture's controls and regions, written down by a
person with a keyboard or by a harness.

The report says so in its own fields, on every run:

```json
"evidence": "declared-capture", "browserDriven": false,
"keysPressed": 0, "screenReaderEmulated": false
```

That is a real limit, and the tool's job is to be honest about it rather than
work around it. An accessibility tool that reports a clean run on evidence it
could not read is worse than no tool, because somebody will ship on it.

## The distinction the whole tool turns on

- The capture **says** what happens. The journey matches it or it does not, and
  that is a pass or a fail.
- The capture **does not say**. Focus becomes undetermined, the region stack
  becomes undetermined with it, and neither is ever compared against an
  expectation -- not as a match and not as a mismatch. The run is `incomplete`,
  which exits 2 and is never a pass.

`capture.activationObserved` is the field that makes the second case bite. A
capture that did not really try each key has an `activatedBy` list of what
somebody happened to press, not of what works -- so a key missing from it
falsifies nothing, and this tool refuses to say it does.

## Why it exists

Whether a dialog gives focus back to the button that opened it is the kind of
thing a reviewer checks once, by hand, and nobody checks again. It is also
exactly the kind of thing a refactor breaks silently.

Writing the journey down -- tab here, press Enter, expect focus there, press
Escape, expect focus back -- turns that one review into a document that can be
diffed, re-run in CI, and pointed at a new capture after the refactor. The
capture is still made by a person with a keyboard. What this tool adds is that
the journey and the capture have to keep agreeing, and that a capture which
stopped saying something stops being read as agreement.

## Quick start

```sh
node bin/keyboard-path-checker.mjs --root examples/restores-focus
```

A dialog whose open/close path restores focus to the control that opened it,
checked two ways: Escape, and the Cancel button. Exit 0.

```sh
node bin/keyboard-path-checker.mjs --root examples/pointer-only
```

The same fixture with two defects: a Delete control the capture records as
activated by pointer only, and a dialog whose `restoresFocusTo` is not the
control that opened it. Exit 1.

```sh
node bin/keyboard-path-checker.mjs --root examples/unobserved
```

**The same journeys and the same controls as `pointer-only`**, with one field
changed: `activationObserved` is `false`. The pointer-only failure is no longer
asserted -- because a capture that never tried the keys cannot falsify one --
and every downstream expectation becomes undetermined with it. Exit 2, status
`incomplete`, **zero errors**: the incomplete flag alone is what keeps this off
a green build.

## What it reads

Two documents under `--root`:

| File | Default name | What it is |
| --- | --- | --- |
| The capture | `controls.json` | Each control -- reachable by Tab? which keys activate it? which region does it open or dismiss? -- and each region -- modal? which keys close it? where does focus go, and come back to? |
| The journeys | `journeys.json` | The keyboard paths a task is meant to be doable by |

Both shapes, and every rule this tool can report, are in
[docs/journey-rules.md](./docs/journey-rules.md).

## Exit codes

| Code | Meaning |
| ---: | --- |
| `0` | both documents were read in full and no error-severity rule fired |
| `1` | both documents were read in full and at least one error-severity rule fired |
| `2` | invalid configuration (stdout empty), or evidence that could not be obtained (an `incomplete` report on stdout, never a `pass`) |

## What it reports

- **stdout** carries the JSON report and nothing else, so it pipes straight into
  a parser. On a configuration error stdout is **empty**.
- **stderr** carries the human summary and diagnostics.
- Findings sort by `(location.file, location.pointer, ruleId, message)`, every
  key compared by UTF-16 code unit. No collator: ICU data differs between Node
  builds, and a report two correct machines order differently is not
  deterministic. One visible consequence is documented rather than hidden:
  `/steps/10` sorts before `/steps/2`.
- `location.pointer` is an RFC 6901 JSON Pointer into the document named by
  `location.file`.
- The envelope carries one tool-specific key, `journeys`: one entry per journey
  run, with how much of it was checked, whether it ran on complete evidence,
  where it ends up, and which regions it left open. `regionsLeftOpen` is `null`
  -- not `[]` -- when the region stack became undetermined, because an empty
  list would be a claim that nothing was left open.
- No wall clock is read anywhere, so the report carries no timestamp and two
  runs over identical documents produce byte-identical stdout.

## Non-goals

These are behaviours, not disclaimers. Each one is enforced by what the tool
does, and the rule that enforces it is named.

- **It does not drive a browser or press a key.** `summary.browserDriven` is
  `false` and `summary.keysPressed` is `0` in every report this tool can
  produce. `summary.evidence` is the constant `"declared-capture"`.
- **It does not emulate a screen reader.** Reaching and activating a control
  says nothing about what was announced. There is no field in the report for
  what a control announced, and the `name` in a capture is echoed as declared --
  never computed, never called an accessible name. Actual spoken output needs
  separate manual evidence, and this report cannot stand in for it.
- **It does not judge a key nobody tried.** With `activationObserved` false or
  absent, every activation is `activation-undetermined` and no key is ever
  reported as failing. `examples/unobserved` is `examples/pointer-only` with
  that one field flipped, and it exits 2 instead of 1.
- **It does not invent focus.** A region that declares no `initialFocus` or no
  `restoresFocusTo` makes focus undetermined, not unchanged. The expectation
  that follows is `focus-undetermined`, not a mismatch and not a match.
- **It does not read a partial machine as a clean one.** Once the region stack
  is undetermined, `region-left-open` is never asserted -- neither is the
  opposite -- and `regionsLeftOpen` is reported as `null`.
- **It does not guess past a step it could not read.** A malformed step stops
  the whole journey being run, because a journey run past a step this tool could
  not read is not the journey that was declared.
- **It writes nothing.** There is no `--out`, no directory is created and no
  file is modified, so no destination check applies to it. The report goes to
  stdout.

## Limits

Every limit is enforced and every one produces an `incomplete` run with a
finding naming the limit. Nothing is silently truncated.

| Flag | Default | Cap |
| --- | ---: | ---: |
| `--max-controls` | 2000 | 200000 |
| `--max-document-bytes` | 1048576 | 67108864 |
| `--max-findings` | 1000 | 20000 |
| `--max-journeys` | 200 | 20000 |
| `--max-runtime-ms` | 10000 | 600000 |
| `--max-steps-per-journey` | 200 | 20000 |

`--max-runtime-ms` is a budget, not a deadline: it is checked between journeys,
so a run overshoots by the cost of the journey in hand. An unknown limit key, an
out-of-range value and a repeated flag are all configuration errors.

## Verification

```sh
npm run check
```

Runs `node --check` over every module, the test suite, all three examples at
their expected exit codes, and `npm pack --dry-run`. No network access at any
point, in the tool or in its tests. No runtime dependencies and no dev
dependencies.

## Repository layout

- `src/` — implementation
- `bin/` — the CLI
- `test/` — deterministic tests and fixtures
- `examples/` — three runnable inputs, one per exit code
- `docs/` — the rule catalog and the document shapes

## License

MIT. See [LICENSE](./LICENSE).
