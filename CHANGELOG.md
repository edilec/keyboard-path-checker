# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html). A `ruleId`
is part of the public interface: renaming one is a breaking change and is
recorded here.

## 0.1.0

First release.

### Added

- A journey machine that runs three step kinds -- `tabTo`, `press` (with or
  without `on`) and `expectFocus` -- against a declared capture of a fixture's
  controls and regions.
- Checks for reachability, activation, dismissal, focus return and regions left
  open.
- `capture.activationObserved`: with it false or absent, no key is ever judged
  to fail, and every activation is reported as undetermined.
- 40 rules with frozen severities, catalogued in `docs/journey-rules.md`.

### What this release deliberately does not claim

- No browser is opened, no key is pressed and no focus is observed. The input is
  exported evidence, and the report says so in `evidence`, `browserDriven`,
  `keysPressed` and `screenReaderEmulated`.
- No screen reader is emulated. Reaching and activating a control says nothing
  about what was announced; that needs separate manual evidence.
- A capture that does not state something is never read as stating its absence.
  An undetermined focus is not compared against an expectation, an undetermined
  region stack is never reported as empty, and both make the run `incomplete`.
