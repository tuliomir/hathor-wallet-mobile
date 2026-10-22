# QA feature graph — design

Date: 2026-10-22 · Status: approved 2026-10-22 · Author: Tulio Miranda (with Claude)

## Intent and why

The mobile wallet has grown to ~34 user-facing features and 13 Unleash flags, and the regressions that reach QA increasingly live **where features cross**, not inside one feature. A recurring example: sending the same token to the same kind of address works on one connection mode and breaks on another. Sending alone has at least three axes the QA specialist runs by hand (destination address type × token type × fullnode/wallet-service = 18 combinations), and a codebase pass found several more axes the code actually branches on.

The current manual suite (`QA/QA.md` plus seven feature suites, ~2,500 lines) was written when the app was much smaller. It still works, but it has fallen into "routine breeds autopilot": the same long sequence is repeated every release, the whole suite is re-run once per facade ("Repeat all steps, starting from step 2"), and expensive configuration switches (e.g. emptying the wallet-service URL fields in Custom Network to force the fullnode facade) are done back and forth.

Many past regressions came from `@hathor/wallet-lib`, not the app. Sending to a multisig address broke because of a lib bug even though the app never branches on P2SH. The mobile wallet is effectively wallet-lib's live integration test, so dimensions that only the lib distinguishes must be first-class.

We want a **machine-readable graph of features, flags, actions, axes and test paths**, from which we render visuals for thinking about test flows today and, later, generate scenario-based automated tests and optimized manual QA guides.

### Audience

The QA specialist and their immediate senior technical leads. They know the domain and can handle dense information. A business-team view was explicitly dropped for now: the combinatorics make it unreadable for non-technical readers no matter the styling.

### What success looks like

- Before a release candidate, the QA specialist can show that everything that worked before still works, and can explain to their lead which features a new change (next likely: **inter-chain transactions**) touches and why.
- The manual run stops repeating expensive setups unnecessarily.
- The graph is the shared material for planning the automated QA suite with their lead.
- The graph stays current without the QA specialist chasing every PR.

## Goals

1. A committed YAML file that is the single source of truth for the core money paths (scope below).
2. A renderer that turns the YAML into one self-contained HTML page with four linked views (A–D below).
3. A defined (not yet populated) shape for per-run QA result files that reference the YAML by commit.
4. Agent instructions (`CLAUDE.md`, `AGENTS.md`) plus a committed, repo-level skill that checks the graph is updated before any agent opens a PR.

## Non-goals (for this version)

- Covering all 34 features. Only the core money paths; the QA specialist wants to review this before it grows.
- Generating the `QA/*.md` guides. The YAML must be shaped so an agent can later generate them, but generation itself is a later step.
- Replacing the existing `QA/*.md` files. They stay as they are.
- Running automated tests or wiring this to Maestro/CI.
- Recording any QA results (only the result file *shape* is defined).
- A business/marketing presentation.
- Changing app code. Suspected bugs found during research are logged separately (see "Side findings").

## Anti-goals (would make this a failure even if it technically works)

- A graph that looks like random boxes and lines. Every edge must carry its reason; every view must answer a workflow question.
- A hand-drawn visual that drifts from the data. Visuals are always rendered from the YAML.
- A YAML that goes stale the moment the next feature lands.
- A run result that can't be traced back to the exact YAML that produced it. (IDs themselves are *not* required to be stable: the YAML is expected to be refactored as the app evolves; history is anchored by commit hash, see "QA run results".)
- Treating "no app-side branching" as "low risk". Lib-only distinctions stay in the matrix.

## Scope of v1: core money paths

Actions:

- **send** (native send flow, including shielded/private send where the environment allows it)
- **create token** (deposit and fee-based)
- **receive** (address display, new address, shielded receive address)
- **history and balances** (token list balance, token detail history, tx detail; public/private split)

Plus the setups and flags these actions depend on. Out of v1: Reown/dApp requests, nano contracts, swap, push notifications, NFTs beyond the amount-format edge, token import, network-settings UI itself (it appears only as a setup), biometrics/lock (PIN appears only as a step).

## Concepts the YAML must express

Decided:

- **Feature**: a user-facing capability (id, name, business-language description, entry screens, main source files, links to other features with a stated reason).
- **Flag**: an Unleash flag (exact name, default, what it gates, other conditions it combines with, whether a change applies live or at next wallet start).
- **Action**: something the user does that has a happy path and error paths (send, create token…). Actions are where combinatorics live.
- **Axis**: a dimension an action varies on, with its values and a **switching cost**. Actions declare which axes they vary on. This is what lets view A spread impact "via axis" to actions whose code didn't change.
- **Setup**: a combination of expensive axis values that is established once and swept inside (e.g. testnet · wallet service · seed wallet).
- **Constraint**: rules over axis combinations classifying them as *valid*, *rejected by design* (with the expected rejection message), *known edge*, or *lib-only risk*.
- **Scenario**: one concrete combination for one action, with expected outcome. Scenarios have ids (unique within one YAML version) and may be generated from axes × constraints or written explicitly.
- **Path**: the screens/steps of an action, with the happy path and each branch to an error message (where in the code it originates).

### Axes and switching cost found in v1 scope

Values below come from a codebase pass and must be re-verified when populating the YAML. Switching cost is a first-cut estimate for the builder to refine.

| Axis | Values | Switching cost | How to switch (today) |
|---|---|---|---|
| network | testnet, shielded testnet, custom/privnet | expensive | Network Settings; restarts wallet; flags re-evaluated per network |
| facade | wallet service, fullnode | expensive | empty/restore WS fields in Custom Network, or Unleash; failed WS start silently falls back to fullnode for 24h (`IGNORE_WS_TOGGLE_FLAG`) |
| wallet type | seed, passkey (with/without shielded xpubs) | very expensive | reset wallet + onboarding |
| flag state | per flag on/off | expensive | Unleash dashboard by device id; 15s polling; some apply only at next start |
| address mode | single, multi | **directional**: single → multi is cheap; multi → single is possible only if no address past index 0 has transactions and no shielded chain is active, otherwise **impossible** for that wallet | Settings → Address mode; reloads wallet. The app also auto-flips single → multi at start if it detects tx past index 0 (`src/screens/AddressMode.js`) |
| private balance state | locked, unlocked, broken key | medium | lock/unlock flow |
| funding precondition | sufficient HTR, zero HTR, has token X | medium | send funds / create tokens beforehand |
| destination address | simple (P2PKH), multisig (P2SH), shielded | cheap | type/scan address |
| token type | HTR, deposit, fee-based | cheap (given funding) | token picker |
| privacy mode | public, hide amount, private | cheap | send amount screen (only when private sends possible) |
| amount class | normal, exact max, zero/empty, decimals, private ≥ 2^40 | cheap | amount input |

Known constraint examples to encode: private mode to simple/multisig is rejected by design; shielded destination outside the shielded environment is rejected; wallet service needs shielded capability `full` for shielded recipients; fee-based token with zero HTR passes the amount screen and fails on Confirm; multisig destination is a lib-only risk.

### Coverage strategy (decided)

Expensive axes (network, facade, wallet type, flag state) define **setups** and are enumerated explicitly. Inside each setup, scenarios are selected **pairwise** over the cheap and medium axes (every pair of values appears in at least one scenario), **plus every** *rejected by design*, *known edge* and *lib-only risk* combination. The strategy is a generator setting, so it can be tightened later (e.g. full cross product for a single risky action) without changing the schema.

### Environments (decided)

Every setup and scenario records which environment it is meant to run in:

- **public testnet** and **testnet-shielded-outputs**: where most (future automated) tests run.
- **local privnet** via `../mobile-e2e-flows` (Maestro on an Android emulator, local fullnode + `sender` wallet): for large amounts, very edge cases and potentially breaking behaviour. Note that this kit forces flags on by editing `FEATURE_TOGGLE_DEFAULTS` locally (marked `E2E-LOCAL`) instead of using Unleash, so "flag state" is switched differently there.
- **store build on a physical device**: what only manual QA can verify.

A scenario whose environment can't currently be reached stays documented and is shown as not runnable rather than dropped.

## The four views

All rendered from the YAML into **one self-contained HTML page** (opens offline in a browser, no server), views linked to each other. Mockups were reviewed and accepted: `2026-10-22-qa-feature-graph-mockups/views.html` (B, C, D as shown; A there was rejected) and `impact-v2.html` (the accepted A). They are content fragments from the brainstorming companion, so they render unstyled outside it; the layout and content are what was approved, not the styling.

- **A · Impact** (entry point). Answers "this change landed — what do I re-test?". Reads left to right: *what changed* (feature / flag / new axis value) → *why it spreads* (**via code**, **via axis**, **via flag**) → *features touched*, each tagged with its spread reason and a one-line why → *scenarios to re-run*, counted, opening as a filtered run plan (D). Inputs in v1: pick a feature, flag or axis value in the page. (Driving it from a PR diff is a later step.)
- **B · Matrix**. One grid per action per setup; each cell is a scenario coloured valid / rejected by design / known edge / lib-only risk.
- **C · Paths**. Per action, the screens of the happy path with every exit to an error message.
- **D · Run plan**. Scenarios grouped by setup and ordered to minimize expensive switches; this is the order future generated `.md` guides follow. Each scenario links to its cell in B and path in C.

## QA run results (shape only)

Results are **never stored in the graph YAML**. One file per run, because each run has its own scope. A run file records:

- the date and commit hash of the YAML it was generated from, stated in plain words at the top (e.g. "This test was run based on the YAML of 22-Oct-2026, version from commit `ab123cde`"), so an analyst can go back in time to the exact instructions behind a result. Scenario ids in a run file mean what they meant *at that commit*; a later refactor that renames, splits or removes them is not a problem. QA never runs on an uncommitted YAML; prefer a commit reachable from `master` or an RC tag, since those aren't rewritten
- app build (RC tag or store version) and device/platform
- the selected scope and why (e.g. impact of a PR, full regression)
- per scenario id: passed / failed / skipped, with notes

Where run files are stored is **open** and not needed for v1; v1 only defines the schema.

## Keeping it current

- New `CLAUDE.md` and `AGENTS.md` at the repo root (neither exists today) so both Claude and Codex agents learn the graph exists and must change along with features, and must call the skill before opening a PR.
- A **skill committed to this repository** (not on anyone's machine) so colleagues and open-source contributors run it too. The repo already commits agent tooling (`.claude/commands/release.md`).
- The skill is designed for a cheaper model (Haiku/Sonnet): compare the PR diff to the YAML and report what's missing (new flag, screen, axis value, error path). When the change is structural (a new feature with new axes, like inter-chain) it says an Opus-level agent should do the update rather than patching it.
- A deterministic script does the mechanical part (e.g. flags in `src/constants.js`, routes in `src/App.js` vs nodes in the YAML; schema validity; id uniqueness and dangling references) so the model only judges what a diff can't tell.
- A stale graph produces a **warning**, not a block. CI enforcement can come later.

## Constraints

- No app code changes in this work.
- Any new dependency is pinned to an exact version (no `^`/`~`) — repo supply-chain rule. `js-yaml` and `yaml` are already present in `node_modules` transitively; adding one as a pinned devDependency is acceptable.
- Rendered HTML must be self-contained and work offline (no CDN fetches).
- Switching costs can be **directional and conditional**: the schema must model a switch as a transition `from → to` with its cost and preconditions, and the run-plan ordering must never schedule an impossible transition (e.g. returning a used wallet to single-address mode). Where a setup needs the "hard" side of a one-way switch, it is reached with a fresh wallet instead.
- Checked-in Markdown in this repo is not hard-wrapped.

## Calls made during design review (Claude's, accepted with the design)

- **Out-of-scope inventory.** Every feature and flag found in the codebase is listed in the YAML, with those outside v1 marked `status: out-of-scope` (id, name, flag link, no axes or scenarios). This keeps the mechanical check quiet on PRs that touch only out-of-scope areas, and gives view A a complete inventory. A PR touching an out-of-scope stub gets an informational note, not a warning.
- **Expected messages come from code, unverified until QA confirms.** Rejection and error messages are copied from the code (with file reference) and marked `verified: false` until the QA specialist confirms them on a device. Where code and `QA/*.md` disagree, both are recorded and flagged. The v1 plan ends with a QA review pass of the populated YAML before it is treated as true.

## Left to the builder

- File locations (suggestion: `QA/graph/` for YAML, schema and renderer; generated HTML git-ignored or committed — builder's call, state which).
- YAML schema details and whether scenarios are mostly generated from axes × constraints or listed.
- Renderer implementation (Node script in the repo's JS toolchain; diagram approach) as long as it's self-contained and has no unpinned deps.
- Exact skill location/format so it is picked up by both Claude Code and Codex — verify each tool's current repo-level skill discovery path rather than assuming; one canonical copy with the other pointing at it is fine.
- Whether to split the YAML into several files.
- Refining the switching-cost scale.

## Roadmap (after v1, not built now)

- Extend coverage beyond the core money paths, feature by feature, after the QA specialist reviews v1.
- **wallet-lib version bump as an impact trigger** in view A: needs scenarios tagged with the lib behaviour they depend on, and a fourth "via lib" spread reason. Wanted in the near future.
- Drive view A from a PR diff instead of a manual pick.
- Agent-generated optimized `QA/*.md` run guides from the YAML, ordered by view D.
- Scenario-based automated tests generated from the YAML (Maestro, building on `../mobile-e2e-flows`).
- Decide where run result files live; CI enforcement of the freshness check.

## Side findings

Suspected bugs and improvement opportunities found during research (e.g. raw wallet-lib error text on wallet service, fee-token-without-HTR failing late, hard-coded create-token fee) are logged locally in `.scratch/feature-graph/findings.md` (git-ignored). They're input for near-future fixes, not part of this work.
