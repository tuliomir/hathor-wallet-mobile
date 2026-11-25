---
name: e2e-suite
description: Run the app's end-to-end scenarios on an emulator, only those a change reaches. Use before opening a PR that touches src/, while writing or fixing e2e scenarios, or to check a release.
---

# e2e suite

`QA/e2e/suite.js` knows what each scenario last passed with, and runs what that says is needed. It starts the privnet and the emulator, and builds and installs the app of this checkout's sources, by itself. Options: the top of that file. The kit under it: `QA/e2e/README.md`.

## 1. Pick the run

| You are | Run |
|---|---|
| on a branch without `QA/e2e/` (most code branches) | from your checkout: `<a checkout of qa/e2e>/QA/e2e/bin/try-branch.sh`. It merges your branch, uncommitted changes included, with the kit in a sibling worktree and runs `dev` there. Options after `--` go to `dev` |
| changing the app | `npm run e2e:dev -- --quick` while you iterate, `npm run e2e:dev` before the PR |
| writing or fixing scenarios | `npm run e2e:dev -- --only <job>` (`history`, `fn/send`, ...). One scenario: `node QA/e2e/run.js --setup pn-fn-seed-multi --action <action> --scenarios <id> --reuse` |
| about to push | `npm run e2e:smoke` |
| checking a release, or ending a change to the suite | `npm run e2e:full -- --minutes 110`, then with `--resume` too until it says it is done |

Put `--dry-run` first on any of them: it lists what would run, why, and about how long. `npm run e2e:status` shows the whole picture in a second.

Use Node 22 (`.nvmrc`). Long runs go in the background; a run prints `all passed` or `NOT all passed`, with one line per job, at its end.

Done when you've read the dry run and its time fits what you are doing.

## 2. Run it, and read the failures

- `failed` scenarios: `failure.png` and `failure.json` beside the scenario in `QA/e2e/evidence/<run>/`, or the run's `viewer.html`. The note says what was on screen and what was wanted.
- `dev` goes on with the wallet the app holds (`--reuse`). A failure there may come from what an earlier scenario left: run it again with `--fresh` before you believe it.
- Every scenario failing at once is the environment: `adb exec-out screencap -p`, then README "Traps".
- The expectation is what the app did. If your change means to alter it, change `QA/graph/graph.yaml` and the checks with it; otherwise the failure is yours to fix.

Done when every job passed, or each failure is explained by something you can name.

## 3. Report what ran

Give the counts per job, and the *owed* line as it is printed: scenarios your change may reach that this run left out, which only a full run clears. Then `npm run e2e:down`: idle, the emulator and the privnet keep the CPU busy.

Done when nothing of the kit shows in `adb devices` and `docker ps`, unless you are about to run again.
