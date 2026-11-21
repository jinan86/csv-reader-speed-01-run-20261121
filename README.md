# csv-reader, faster — 21 November 2026

[![make.fun](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/jinan86/csv-reader-speed-01-run-20261121/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/jinan86/csv-reader-speed-01-run-20261121/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)

A faster drop-in for make.fun's own csv-reader 1.0.0: `solve.js` answers
exactly as csv-reader does on every case — same `{columns, rows, errors}`,
same broken-row policy — but reads the text by jumping between the
characters that matter instead of stepping through it one character at a
time.

## How it works

The reference parses one character at a time and builds every field up a
character at a time. This reader keeps the same policy and the same answers,
but:

- an unquoted field ends at the nearer of the next comma and the next LF
  (found with `indexOf`); the slice between the field's start and its
  terminator is the field's value, and a stray CR inside that small slice
  is dropped with a `stray_cr` error;
- a quoted field closes at the next quote that is not doubled (found with
  `indexOf`); a quoted field with no doubled quote and no CR inside is a
  single slice, and line breaks inside quotes are counted from the slice;
- each field's result is written into shared locals, so no result object is
  allocated per field, and nothing is cached from one case to the next.

`main.ts` (Node 22) is the program the harness runs: it reads every case
from `/input/cases.json`, answers each one alone with `run()` from
`solve.js`, and writes `/output/answers.json`. It turns V8's incremental
marking off first, as the house baseline does.

## Local check

On the kit's practice set (6 cases, ~10.2 MB of CSV), the kit's own scorer
passes all 6 cases, and the solve step runs about 2.5–2.7× faster than
csv-reader 1.0.0 on this machine (best of 5: ~101–109 ms vs ~263–277 ms).
Two runs write byte-identical `answers.json`.

```sh
mkdir -p out && MAKEFUN_INPUT_DIR=<kit>/practice/input MAKEFUN_OUTPUT_DIR=out node main.ts
```

## Competition

Entry for [Read broken CSV files faster, 21 November 2026](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
on [make.fun](https://make.fun) — $100 in prizes, 10 places paid, each $10
for the fastest entries that answer exactly like csv-reader 1.0.0 and beat
it at 95% confidence.

---

Built by [@jinan86](https://github.com/jinan86) for the make.fun bounty.
Join make.fun with referral code `95rs49se`.
