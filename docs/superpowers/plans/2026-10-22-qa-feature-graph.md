# QA Feature Graph v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A committed YAML graph of the core money paths (features, flags, axes, setups, actions, paths, constraints), Node tools that validate it, generate pairwise scenarios and a cost-ordered run plan, render one offline HTML page with views A–D, check the graph's freshness against the code, plus `AGENTS.md`/`CLAUDE.md` and a committed pre-PR skill.

**Architecture:** `QA/graph/graph.yaml` is the single source of truth. Pure CommonJS modules under `QA/graph/tools/` compute everything (scenarios, run plan, impact for every pickable item) in Node; `render.js` embeds the precomputed data as JSON in one HTML file whose inlined vanilla JS only displays it. A CLI wires validate / render / check together for humans, npm scripts and the skill.

**Tech Stack:** Node (CommonJS, repo's ESLint airbnb config), `yaml@2.8.0` (pinned devDependency), Jest 29 via the repo's existing config. No other dependencies.

**Spec:** `docs/superpowers/specs/2026-10-22-qa-feature-graph-design.md` (accepted mockups in `docs/superpowers/specs/2026-10-22-qa-feature-graph-mockups/`). Read both before any task.

## Global Constraints

- No app code changes: nothing under `src/`, `android/`, `ios/` is modified.
- Dependencies pinned to exact versions, no `^`/`~`. Only new dep: `"yaml": "2.8.0"` in `devDependencies`. Regenerate `package-lock.json` with Node 22 / npm 10 (CI uses Node 22; other majors produce a lock CI rejects).
- Rendered HTML is self-contained and works offline: no `http(s)://` in any `src=`/`href=`, no CDN, no fetch.
- Visuals are always rendered from the YAML; nothing hand-drawn.
- Every edge/spread in view A carries a reason (`via code` / `via axis` / `via flag`) and a one-line why.
- Ids are unique within one YAML version; they are **not** required to be stable across versions. History is anchored by the YAML commit hash.
- Switch costs are directional and conditional; the run plan never schedules an impossible transition; where one is needed, it uses the axis `fallback` (fresh wallet).
- Coverage: expensive axes form setups; inside each (action, setup), pairwise over action axes plus every rejected/edge/lib-risk combination.
- Expected messages are copied from code with a `source` (`path:line`) and `verified: false`.
- Stale graph → warning, never a failing exit code in the PR flow (`check` exits 0 on warnings, 1 only on schema errors).
- Test files import jest globals from `@jest/globals`. Every `.js` file under `__tests__/` is collected as a test by jest, so fixtures are `.yaml` only.
- Checked-in Markdown is not hard-wrapped. JS files start with the repo's MIT license header (copy from `scripts/update_translations.js`).
- Commit titles: conventional commits, ≤ 50 chars; end commit messages with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Do not push.

## Review Focus

- A setup reachable only through an impossible transition (multi → single address mode on a used wallet): the run plan must route through the axis fallback and say so, never emit the impossible step. → test in Task 3.
- A constraint that matches no combination (dead rule after a refactor or typo'd value): validation should warn naming the constraint, not silently ignore it. → test in Task 2.
- Expected messages containing quotes, `<`, `&` or the literal `</script>`: the page must stay valid and not execute injected markup. → test in Task 5.
- Rendering while `graph.yaml` has uncommitted changes: the page header must say "UNCOMMITTED" instead of showing a hash that doesn't contain those changes. → test in Task 6.
- A PR that only touches files of an out-of-scope feature: the check prints a note, not a warning, so warnings stay meaningful. → test in Task 6.

---

## File structure

| Path | Responsibility |
|---|---|
| `QA/graph/graph.yaml` | The data (Tasks 7–9) |
| `QA/graph/README.md` | Schema reference, how to render/check, run-file shape |
| `QA/graph/runs/TEMPLATE.yaml` | Shape of one QA run result file |
| `QA/graph/tools/load.js` | Parse YAML, validate schema and references |
| `QA/graph/tools/scenarios.js` | Combination enumeration, classification, pairwise selection |
| `QA/graph/tools/runplan.js` | Directional transition costs, setup ordering |
| `QA/graph/tools/impact.js` | Spread from a picked feature / flag / axis value |
| `QA/graph/tools/render.js` + `QA/graph/tools/view/{app.js,style.css}` | HTML page (data embedded, client only displays) |
| `QA/graph/tools/freshness.js` | Code-vs-graph check |
| `QA/graph/tools/cli.js` | `validate`, `render`, `check` commands |
| `QA/graph/dist/` | Rendered output, git-ignored |
| `__tests__/qaGraph/*.test.js`, `__tests__/qaGraph/fixtures/*.yaml` | Tests and fixture graphs |
| `AGENTS.md`, `CLAUDE.md` | Agent instructions (Task 10) |
| `.agents/skills/qa-graph-check/SKILL.md`, `.claude/skills/qa-graph-check/SKILL.md` | Pre-PR skill (Task 10) |

## Schema (shared by every task)

`graph.yaml` top-level keys, all required:

```yaml
version: 1
costs: { cheap: 1, medium: 5, expensive: 20, very-expensive: 60 }
environments: [{ id, name, notes }]
features: [{ id, name, description, status: in-scope|out-of-scope, screens: [route], files: [path or dir/], flags: [flagId], links: [{ to: featureId, reason }], introduces: ['axisId:valueId'], actions: [actionId] }]
flags: [{ id, name, constant, default, gates: [featureId], combinesWith: [text], appliesAt: live|next-start|next-pin, status }]
axes: [{ id, name, kind: setup|action, values: [{ id, name }], how, switch: { cost: costKey, transitions: [{ from, to, cost?: costKey, impossible?: true, when?: text }], fallback?: { cost: costKey, how } } }]
setups: [{ id, name, values: { setupAxisId: valueId }, environment: envId, runnable: bool, notes? }]
actions: [{ id, name, feature: featureId, axes: [actionAxisId], setups: [setupId], path: { steps: [{ id, screen, name }], outcomes: [{ id, kind: success|error, at: stepId, message, source, verified: false }] } }]
constraints: [{ id, action, when: { axisId: valueId | [valueId] }, class: invalid|rejected|edge|lib-risk, outcome?: outcomeId, note }]
```

Semantics: `when` may name setup or action axes; a combination matches when every listed axis has a listed value. `invalid` = combination can't be constructed (excluded, no scenario). `rejected` = constructible, app refuses it (requires `outcome` of kind error). `edge`/`lib-risk` = valid but risky. Transition cost defaults to `switch.cost` unless a matching `transitions` entry overrides it.

Generated scenario object (produced by Task 2, consumed by 3–5):

```js
{ id: 'send:ws-testnet-seed-multi:multisig.fee.public', action: 'send', setup: 'ws-testnet-seed-multi',
  values: { /* setup + action axis values */ }, classes: ['lib-risk'], constraintIds: ['c-multisig-lib'], expected: ['ok-sent'] }
```

`id` = `${action}:${setup}:${actionAxisValues joined by '.' in action.axes order}`. `classes` empty means plain valid. `expected` = outcome ids of matched rejected/edge constraints, else the action's `success` outcome ids.

---

### Task 1: Loader, validator, fixture and scaffolding

**Files:**
- Create: `QA/graph/tools/load.js`, `QA/graph/README.md` (schema section from above, written as reference prose), `QA/graph/runs/TEMPLATE.yaml`, `__tests__/qaGraph/fixtures/mini.yaml`, `__tests__/qaGraph/load.test.js`
- Modify: `package.json` (devDependency `"yaml": "2.8.0"`; scripts `"qa:graph": "node QA/graph/tools/cli.js render"`, `"qa:graph:check": "node QA/graph/tools/cli.js check"`), `package-lock.json`, `.gitignore` (add `QA/graph/dist/`)

**Interfaces:**
- Produces: `loadGraph(filePath: string) -> object` (throws with file path on YAML syntax error); `validateGraph(graph) -> { errors: string[], warnings: string[] }`. Errors name the offending id and field, e.g. `constraint c-x: unknown value 'foo' for axis 'dest'`.

The fixture `mini.yaml` is reused by every later test. It must contain exactly:
- environment `testnet`; costs as in the schema
- features `send-f` (in-scope, `files: [src/screens/Send/]`, `flags: [fbt]`, `links: [{to: pin-f, reason: PIN confirms send}]`, `introduces: []`, `actions: [send]`), `pin-f` (in-scope, `files: [src/screens/PinScreen.js]`), `fee-f` (in-scope, `introduces: ['token:fee']`, `flags: [fbt]`), `swap-f` (out-of-scope, `files: [src/screens/TokenSwap/]`)
- flag `fbt` (`name: fee-based-tokens.rollout`, `constant: FBT_FEATURE_TOGGLE`, gates `[fee-f]`)
- setup axes `facade` (ws, fn; cost expensive) and `addr` (single, multi; cost cheap; transition `multi → single impossible: true`; `fallback: { cost: very-expensive, how: reset wallet and re-import }`)
- action axes `dest` (simple, multisig, shielded), `token` (htr, fee), `privacy` (public, private), all cheap
- setups `ws-single`, `ws-multi`, `fn-single`, `fn-multi` (all runnable, env testnet)
- action `send` (feature send-f, axes `[dest, token, privacy]`, all four setups) with steps `addr-in`, `amount`, `confirm` and outcomes `ok-sent` (success, at confirm), `err-priv` (error at amount, message `The selected privacy mode requires a shielded address.`), `err-htr` (error at confirm, message `Insufficient HTR to cover the network fee.`)
- constraints: `c-shielded-fn` invalid `{facade: fn, dest: shielded}`; `c-priv` rejected `{privacy: private, dest: [simple, multisig]}` outcome `err-priv`; `c-multisig` lib-risk `{dest: multisig}`; `c-fee` edge `{token: fee}` outcome `err-htr`

- [ ] **Step 1: Write failing tests** in `load.test.js`:
  - `loads the mini fixture without errors`: `validateGraph(loadGraph(fixture)).errors` toEqual `[]`.
  - `reports unknown axis value in a constraint`: mutate a copy so `c-priv.when.dest = ['simple', 'nope']`; errors contain a string including `c-priv` and `nope`.
  - `reports dangling feature link`: `pin-f` → link to `ghost`; errors contain `ghost`.
  - `requires outcome on rejected constraints`: delete `c-priv.outcome`; errors contain `c-priv`.
  - `rejects duplicate ids within a collection`: duplicate setup id `ws-single`; errors contain `ws-single`.
  - `includes the file path in YAML syntax errors`: write `a: [` to a tmp file; `expect(() => loadGraph(tmp)).toThrow(tmp)`.
- [ ] **Step 2: Run** `npx jest __tests__/qaGraph/load.test.js` — Expected: FAIL (module not found).
- [ ] **Step 3: Implement `load.js`** with `yaml`'s `parse`; validation is hand-written reference checks over the schema above (no JSON-schema lib). Write `README.md` and `TEMPLATE.yaml` (fields: `yamlCommit`, `yamlDate`, a top comment line in the form `This test was run based on the YAML of <date>, version from commit <hash>.`, `appBuild`, `device`, `platform`, `environment`, `scope: { reason, picks: [] }`, `results: [{ scenario, status: passed|failed|skipped, notes }]`; README states scenario ids mean what they meant at `yamlCommit`).
- [ ] **Step 4: Run** the same jest command — Expected: PASS. Then `npx eslint QA/graph __tests__/qaGraph` — Expected: no errors.
- [ ] **Step 5: Commit** — `git add` the files above; `git commit -m "feat(qa): add feature graph loader and schema"`.

### Task 2: Scenario generation

**Files:**
- Create: `QA/graph/tools/scenarios.js`, `__tests__/qaGraph/scenarios.test.js`
- Modify: `QA/graph/tools/load.js` (dead-constraint warning)

**Interfaces:**
- Consumes: `loadGraph`, `validateGraph`.
- Produces: `classifyCombo(graph, actionId, values) -> { excluded: bool, classes: string[], constraintIds: string[], expected: string[] }`; `selectScenarios(graph, actionId, setupId) -> Scenario[]`; `allScenarios(graph) -> Scenario[]` (every action × each of its setups, in YAML order).

Selection algorithm (not determined by the tests alone):
1. Enumerate the cross product of the action's axes in YAML value order, merged with the setup's values; drop `excluded`.
2. Required set: for each non-invalid constraint of this action, the first enumerated combo it matches.
3. Pairwise: the pairs to cover are all (axisA=value, axisB=value) pairs over action axes that occur in at least one **plain-valid or edge/lib-risk, non-rejected** combo. Rejected combos don't count toward coverage (the app stops early, hiding the other values). Start with pairs already covered by non-rejected required combos; then repeatedly add the non-rejected combo covering the most uncovered pairs (tie → earliest in enumeration) until none are left.
4. Return required ∪ pairwise, de-duplicated, in enumeration order.

- [ ] **Step 1: Write failing tests:**
  - `classifies private to simple as rejected`: `classifyCombo(g, 'send', {facade:'ws', addr:'single', dest:'simple', token:'htr', privacy:'private'})` → `classes` toEqual `['rejected']`, `expected` toEqual `['err-priv']`.
  - `excludes shielded on fullnode`: with `facade:'fn', dest:'shielded'` → `excluded` true.
  - `marks multisig as lib-risk and fee as edge together`: `dest:'multisig', token:'fee', privacy:'public'` → `classes` toEqual `['lib-risk','edge']` (constraint order), `expected` toEqual `['err-htr']`.
  - `plain combo expects the success outcome`: simple/htr/public → `classes` `[]`, `expected` `['ok-sent']`.
  - `covers every valid pair`: for each setup, compute all pairs from the non-excluded, non-rejected enumeration and assert each appears in some returned scenario.
  - `includes a scenario for every constraint that can match`: for `ws-single`, constraint ids appearing across scenarios ⊇ `['c-priv','c-multisig','c-fee']`; for `fn-single` the set excludes `c-shielded-fn` (invalid never yields scenarios).
  - `never returns excluded combos`: no `fn-*` scenario has `dest: 'shielded'`.
  - `is deterministic`: two calls deep-equal.
  - `ids follow action:setup:values`: first `ws-single` scenario id matches `/^send:ws-single:[a-z]+\.[a-z]+\.[a-z]+$/`.
  - `warns about a constraint that matches no combination` (Review Focus): add constraint `c-dead` `{dest: shielded, facade: fn}` with class `edge`; `validateGraph(g).warnings` contains a string with `c-dead`.
- [ ] **Step 2: Run** `npx jest __tests__/qaGraph/scenarios.test.js` — Expected: FAIL.
- [ ] **Step 3: Implement** `scenarios.js` per the algorithm; add the dead-constraint check to `validateGraph`: a non-invalid constraint is dead when it matches no combination that survives the `invalid` exclusions across all of its action's setups; an `invalid` constraint is dead when it matches no combination at all. `load.js` requires `scenarios.js` lazily inside that check to avoid a require cycle.
- [ ] **Step 4: Run** both test files — Expected: PASS; eslint clean.
- [ ] **Step 5: Commit** — `feat(qa): generate pairwise test scenarios`.

### Task 3: Run plan

**Files:**
- Create: `QA/graph/tools/runplan.js`, `__tests__/qaGraph/runplan.test.js`

**Interfaces:**
- Consumes: `allScenarios`, Scenario objects.
- Produces: `transitionCost(graph, axisId, from, to) -> { cost: number, impossible: bool, via: 'switch'|'fallback'|'none', how: string }` (`from === to` → cost 0, via `none`; impossible with fallback → fallback cost, via `fallback`; impossible without fallback → cost `Infinity`, impossible true); `setupDistance(graph, fromSetupId, toSetupId) -> { cost, steps: [{ axis, from, to, via, how }] }` (sum over differing axes); `planRun(graph, scenarios, { start? }) -> [{ setup, cost, steps, scenarios }]`.

Ordering: group scenarios by setup; begin at `start` or the first setup in YAML order that has scenarios; then greedy nearest-neighbour by `setupDistance` over remaining setups (tie → YAML order). The first group has `cost: 0, steps: []`. If every remaining setup is unreachable (`Infinity`), throw naming the stuck setup.

- [ ] **Step 1: Write failing tests:**
  - `same value costs nothing`: `transitionCost(g,'addr','multi','multi').cost` → 0.
  - `single to multi uses the cheap switch`: cost 1, via `switch`.
  - `multi to single goes through the fallback` (Review Focus): via `fallback`, cost 60, `how` contains `reset wallet`.
  - `orders setups by cheapest next switch`: `planRun(g, allScenarios(g)).map((s) => s.setup)` toEqual `['ws-single','ws-multi','fn-multi','fn-single']` (from ws-single: ws-multi 1 < fn-single 20; from ws-multi: fn-multi 20 < fn-single 80; last hop costs 60), and the last group's `steps[0].via` is `fallback`.
  - `no step is ever impossible`: every step across the plan has `via !== 'none'` or cost 0, and no group cost is `Infinity`.
  - `throws when a setup is unreachable`: remove the fallback from `addr` and plan only `['ws-multi','ws-single']` scenarios starting at `ws-multi` → throws containing `ws-single`.
  - `keeps every scenario exactly once`: flattened scenario ids toEqual `allScenarios(g)` ids as a set, same length.
- [ ] **Step 2: Run** `npx jest __tests__/qaGraph/runplan.test.js` — FAIL.
- [ ] **Step 3: Implement** `runplan.js`.
- [ ] **Step 4: Run** — PASS; eslint clean.
- [ ] **Step 5: Commit** — `feat(qa): order run plan by switching cost`.

### Task 4: Impact

**Files:**
- Create: `QA/graph/tools/impact.js`, `__tests__/qaGraph/impact.test.js`

**Interfaces:**
- Consumes: `allScenarios`, `planRun`.
- Produces: `computeImpact(graph, pick: { type: 'feature'|'flag'|'axisValue', id: string }) -> { pick, changed: { features: [], flags: [], axisValues: [] }, touched: [{ feature, reasons: [{ via: 'code'|'axis'|'flag', why }] }], scenarios: Scenario[], plan }`; `allPicks(graph) -> pick[]` (every in-scope feature, every flag, every `axis:value`).

Spread rules:
- `changed`: a feature pick → the feature, its `flags`, its `introduces`; a flag pick → the flag; an axisValue pick → that value.
- **via code**: features whose `links` point to a changed feature (they depend on it); `why` = the link `reason`.
- **via flag**: features in a changed flag's `gates`; `why` = `` `must be tested with ${flag.name} on and off` ``.
- **via axis**: for each changed axis value, the features owning actions whose `axes` (or setup axes) include that axis; `why` = `` `${action.name} varies on ${axis.name}; new value ${value.name}` ``.
- Changed features themselves appear in `touched` with via `code`, why `changed directly`.
- `scenarios`: for axis values, scenarios whose `values` contain that value; otherwise all scenarios of actions owned by touched features. `plan` = `planRun` over them.

- [ ] **Step 1: Write failing tests** (fixture):
  - `feature pick spreads via its links`: picking `pin-f` → `touched` includes `send-f` with reason `{ via: 'code', why: 'PIN confirms send' }`.
  - `flag pick spreads via gates`: picking flag `fbt` → `fee-f` with via `flag`, why contains `fee-based-tokens.rollout`.
  - `axis value pick spreads via axis to unchanged code`: picking `token:fee` → `send-f` with via `axis`; every returned scenario has `values.token === 'fee'`.
  - `feature introducing a value spreads via axis`: picking `fee-f` → `changed.axisValues` toEqual `['token:fee']` and `send-f` has a via `axis` reason.
  - `every touched entry has at least one reason with non-empty why`.
  - `allPicks excludes out-of-scope features`: no pick with id `swap-f`.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS; eslint clean.
- [ ] **Step 5: Commit** — `feat(qa): compute change impact over the graph`.

### Task 5: HTML renderer (views A–D)

**Files:**
- Create: `QA/graph/tools/render.js`, `QA/graph/tools/view/app.js`, `QA/graph/tools/view/style.css`, `__tests__/qaGraph/render.test.js`

**Interfaces:**
- Consumes: `allScenarios`, `planRun`, `computeImpact`, `allPicks`.
- Produces: `buildPageData(graph, version: { label: string }) -> { version, graph, scenarios, plan, impacts: { [pickKey]: impactResult } }` (`pickKey` = `${type}:${id}`); `renderHtml(graph, version) -> string`; `serializeForScript(data) -> string` (JSON with `<`, `>`, `&`, U+2028, U+2029 escaped as `<` etc.).

The page: a header with `version.label`, four tabs/sections with ids `view-impact`, `view-matrix`, `view-paths`, `view-plan`, and cross-links (`#scenario-<id>` anchors in B, links from D rows to B cell and C path). Layout and content follow the accepted mockups: A is the left-to-right four-column flow of `impact-v2.html` driven by a picker of `allPicks`; B is one table per (action, setup) with rows/cols = the action's first two axes and remaining axes listed inside cells, cells coloured by class (valid, rejected, edge, lib-risk; not-runnable setups greyed); C draws steps left to right with error outcomes below their `at` step (plain SVG/HTML, no library); D lists setup groups with their transition steps (fallback steps highlighted) and scenario rows. All DOM text is set via `textContent`, never `innerHTML` with data.

- [ ] **Step 1: Write failing tests:**
  - `contains the four views`: output includes each of the four ids.
  - `is self-contained`: output does not match `/(src|href)=["']https?:/`.
  - `escapes script-breaking text` (Review Focus): set an outcome message to `</script><b>"x" & 'y'</b>`; output contains exactly one `</script>` occurrence per inlined script block (count `<script` openings == count of `</script>`), and `JSON.parse` of the embedded block (extract between the data script tags) round-trips the original message.
  - `embeds an impact for every pick`: `Object.keys(buildPageData(g, v).impacts).length === allPicks(g).length`.
  - `shows the version label`: output includes `version.label`.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement** (`render.js` reads `view/app.js` and `view/style.css` with `fs` and inlines them; data goes in `<script type="application/json" id="graph-data">`).
- [ ] **Step 4: Run** — PASS; eslint clean (add `/* eslint-env browser */` at top of `view/app.js`).
- [ ] **Step 5: Commit** — `feat(qa): render feature graph views to HTML`.

### Task 6: Freshness check and CLI

**Files:**
- Create: `QA/graph/tools/freshness.js`, `QA/graph/tools/cli.js`, `__tests__/qaGraph/freshness.test.js`

**Interfaces:**
- Consumes: `loadGraph`, `validateGraph`, `renderHtml`.
- Produces: `extractFlagNames(constantsSrc: string) -> string[]` (string literals ending `.rollout` assigned to exported consts); `extractRoutes(appSrc: string) -> string[]` (values of `name='…'` / `name="…"` on `Stack.Screen`/`Tab.Screen`); `checkFreshness(graph, { constantsSrc, appSrc, changedFiles: string[], graphChanged: bool }) -> { warnings: string[], notes: string[] }`; `describeVersion({ commit, date, dirty }) -> string` (`dirty` → `UNCOMMITTED changes on top of <commit>`; else `YAML of <date>, commit <commit>`).
- CLI: `node QA/graph/tools/cli.js validate|render [--out QA/graph/dist/graph.html]|check [--base origin/master]`. `render` gets commit/date/dirty from `git log -1 --format=%h %cs -- QA/graph/graph.yaml` and `git status --porcelain QA/graph/graph.yaml`. `check` gets changed files from `git diff --name-only <base>...HEAD`, prints `ERROR`/`WARN`/`NOTE` lines, exits 1 only on validation errors.

Check rules:
- WARN: a flag name in code missing from `flags[].name`; a flag in the graph missing from code (renamed/removed).
- WARN: a route in code not listed in any feature's `screens`.
- WARN: a changed file under an **in-scope** feature's `files` while `graphChanged` is false — message names the feature and asks whether its paths/axes/outcomes changed.
- NOTE: same, but the feature is out-of-scope.
- NOTE: an outcome with `verified: false` whose `source` file changed.

- [ ] **Step 1: Write failing tests:**
  - `extracts rollout flags`: from `export const A = 'x.rollout';\nexport const B = 'other';` → `['x.rollout']`.
  - `extracts screen routes`: from `<Stack.Screen name='Foo' component={F} />` and `<Tab.Screen name="Bar" />` → `['Foo','Bar']`.
  - `warns about a flag missing from the graph`: constants with `fee-based-tokens.rollout` and `new.rollout` → a warning containing `new.rollout`.
  - `warns about a flag removed from code`: constants without `fee-based-tokens.rollout` → warning containing it.
  - `warns when an in-scope feature changes without a graph update`: changedFiles `['src/screens/Send/SendConfirm.js']`, graphChanged false → warning containing `send-f`.
  - `only notes out-of-scope changes` (Review Focus): changedFiles `['src/screens/TokenSwap/X.js']` → no warnings; a note containing `swap-f`.
  - `stays quiet when the graph changed too`: same in-scope change with graphChanged true → no warning about `send-f`.
  - `describes an uncommitted version` (Review Focus): `describeVersion({ commit: 'ab123cd', date: '2026-10-22', dirty: true })` contains `UNCOMMITTED`; with `dirty: false` → `YAML of 2026-10-22, commit ab123cd`.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement** both files.
- [ ] **Step 4: Run** all `__tests__/qaGraph` — PASS; eslint clean. Smoke: `node QA/graph/tools/cli.js validate` on a copy of the fixture via `--graph __tests__/qaGraph/fixtures/mini.yaml` (add the `--graph` option, default `QA/graph/graph.yaml`) prints no errors.
- [ ] **Step 5: Commit** — `feat(qa): add graph freshness check and CLI`.

### Task 7: Populate inventory (features, flags, environments)

**Files:**
- Create: `QA/graph/graph.yaml`

Content source: the 34 features and 13 flags in the spec's research (re-derive from `src/App.js`, `src/constants.js` lines ~233-282, `src/sagas/*`; do not trust the spec's file paths without opening them). In-scope features (status `in-scope`): send, shielded-send, token-create, fee-tokens, receive, shielded-receive, address-mode, tx-history, dashboard, shielded (balance/unlock), wallet-service, network-settings, wallet-create, wallet-import, passkey-onboarding, pin-unlock, token-register, feature-flags, reset-wallet. Everything else `out-of-scope` with id, name, description, screens, files, flags. Every flag listed with `appliesAt` taken from the spec's "what happens when a flag changes mid-session" notes. Environments: `testnet`, `testnet-shielded`, `local-privnet` (notes: `../mobile-e2e-flows`, flags forced on via `E2E-LOCAL` edits, not Unleash), `store-device`.

Leave `axes`, `setups`, `actions`, `constraints` as empty lists in this task.

- [ ] **Step 1:** Write the inventory.
- [ ] **Step 2: Run** `node QA/graph/tools/cli.js validate` — Expected: no errors. `node QA/graph/tools/cli.js check --base HEAD` — Expected: no WARN lines about flags or routes (every flag and every route accounted for).
- [ ] **Step 3: Commit** — `feat(qa): add feature and flag inventory`.

### Task 8: Populate axes, setups and transitions

**Files:**
- Modify: `QA/graph/graph.yaml`

Use the spec's axes table as the starting point, re-verified in code. Setup axes: `network` (testnet, testnet-shielded, local-privnet), `facade` (wallet-service, fullnode), `wallet` (seed, passkey), `addr` (single, multi — `multi → single` impossible with `when: wallet has tx past index 0 or a shielded chain is active`, fallback `very-expensive`, how `reset and import a fresh seed`; `single → multi` cheap), plus `flag-fbt` (on, off) for create token. Action axes: `dest`, `token`, `privacy`, `amount`, `funding`, `private-balance`. Every axis gets `how` (from `QA/QA.md` "Common Activities" where it exists, quoting the section name). Setups: the cross product actually needed by the v1 actions, with `runnable: false` for any combination that's impossible to reach today (state why in `notes`), e.g. passkey wallets per platform if not available. Note on facade: `how` must mention the 24h `IGNORE_WS_TOGGLE_FLAG` fallback trap.

- [ ] **Step 1:** Write axes and setups.
- [ ] **Step 2: Run** `validate` — no errors. `render` and open `QA/graph/dist/graph.html` — view D lists setups and shows no impossible step.
- [ ] **Step 3: Commit** — `feat(qa): add setup and action axes`.

### Task 9: Populate actions, paths and constraints

**Files:**
- Modify: `QA/graph/graph.yaml`

Actions: `send`, `create-token`, `receive`, `history`. For each: steps from the real screens (`src/screens/Send*.js`, `CreateToken*.js`, `Receive.js`/`ReceiveMyAddress.js`, `MainScreen.js`/`TokenDetail`), outcomes with the exact user-facing message copied from code (`t\`…\`` strings) and `source: path:line`, `verified: false`. Constraints at minimum (re-verify each in code): shielded destination outside the shielded environment rejected; private mode to simple/multisig rejected; wallet service needs shielded capability `full` for shielded recipients; fee token with zero HTR passes amount and fails on Confirm (edge, outcome at `confirm`); multisig destination lib-risk; exact-max HTR plus fee fails on Confirm; private amount ≥ 2^40 rejected; single address mode + shielded chain invalid; wallet service + single mode has no shielded receive address. Any suspected bug or improvement found while doing this is appended to `.scratch/feature-graph/findings.md` (local, not committed), not fixed.

- [ ] **Step 1:** Write the four actions and their constraints.
- [ ] **Step 2: Run** `validate` — no errors and no dead-constraint warnings. `render` — view B shows send scenarios coloured by class; view C shows each action's path; view A for pick `axisValue:token:fee` lists send and create-token via axis.
- [ ] **Step 3: Run** `node -e "const {loadGraph}=require('./QA/graph/tools/load');const {allScenarios}=require('./QA/graph/tools/scenarios');console.log(allScenarios(loadGraph('QA/graph/graph.yaml')).length)"` and record the count in the commit body (it tells the QA specialist the size of a full run).
- [ ] **Step 4: Commit** — `feat(qa): model core money path actions`.

### Task 10: Agent instructions and the pre-PR skill

**Files:**
- Create: `AGENTS.md`, `CLAUDE.md`, `.agents/skills/qa-graph-check/SKILL.md`, `.claude/skills/qa-graph-check/SKILL.md`

- `AGENTS.md` (canonical): short section "QA feature graph" — what `QA/graph/graph.yaml` is, that any PR adding/changing a feature, flag, screen, axis value or error message must update it, and that agents must run the `qa-graph-check` skill before opening a PR. Point to `QA/graph/README.md`. Keep it to what an agent needs; no repo overview.
- `CLAUDE.md`: a single line `@AGENTS.md` (Claude Code import) so there's one source.
- Skill, canonical in `.agents/skills/qa-graph-check/SKILL.md`; `.claude/skills/qa-graph-check/SKILL.md` has the same frontmatter and one line: read and follow the canonical file. (No symlinks: the repo has Windows contributors, see `WINDOWS.md`.) Before writing, verify the current repo-level skill discovery paths of Claude Code and Codex from their docs; if either differs from these paths, use the documented one and note it in the commit body.
- Skill body: (1) run `npm run qa:graph:check -- --base origin/master` and read its output; (2) for each WARN, read the diff and decide whether the graph needs an update; (3) judge what the script can't: new axis value, new error message, new path step, changed switching cost; (4) if the needed update is local (add an outcome, a flag, a screen, a constraint), make it and re-run `validate`; if it's structural (new feature with new axes, new setup axis, changes to many actions — e.g. inter-chain), don't patch: report that an Opus-level agent should update the graph, with the list of what's missing; (5) never block the PR; put a short "QA graph" note in the PR body (updated / not needed / needs follow-up). Designed to run on a cheaper model; say so in the description so the agent may delegate it to a Haiku/Sonnet subagent.
- Write the skill using the `writing-for-agents` skill, and test it: give a fresh subagent without the skill a sample diff (e.g. a new `.rollout` flag in `src/constants.js` + a new error string in `SendConfirmScreen.js`) and confirm it misses the graph; then with the skill, confirm it reports both and classifies the change as local.

- [ ] **Step 1:** Verify discovery paths (docs).
- [ ] **Step 2:** Write `AGENTS.md`, `CLAUDE.md`, both skill files.
- [ ] **Step 3:** Run the with/without-skill subagent test described above; record the outcome in the commit body.
- [ ] **Step 4: Run** `npx eslint QA/graph __tests__/qaGraph && npx jest __tests__/qaGraph` — PASS.
- [ ] **Step 5: Commit** — `docs: add agent rules and qa-graph-check skill`.

### Task 11: Hand-off for the QA review pass

- [ ] **Step 1: Run** `npm run qa:graph`, then the full `npm test` and `npm run lint` — Expected: pass (lint warnings pre-existing elsewhere are fine; none in new files).
- [ ] **Step 2:** Serve or share `QA/graph/dist/graph.html` to the QA specialist (they browse from a Mac over Tailscale: `python3 -m http.server --bind <tailscale ip>` from `QA/graph/dist/`, give the `*.ts.net` URL).
- [ ] **Step 3:** Report: scenario count per action, setups marked not runnable, constraints and messages still `verified: false`, and the side findings file. Do not open a PR.
