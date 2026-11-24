# e2e roadmap: from the send scenarios to the whole app

Status on 2026-11-24. The kit runs the QA graph's send and create-token scenarios on the local privnet, with a seed wallet, on the fullnode and the wallet-service facades. It runs them on an Android emulator, records them, and shows them in a viewer for a person to check. This file is where it stands, what holds it back, and the way to the whole app.

## Where it stands

| | |
|---|---|
| Graph | 43 features, 13 setups, 4 actions modelled (send, create-token, receive, history): 337 scenarios. Create-token got its amounts and names as axes. Multichain isn't modelled. |
| Automated | Two actions on two setups (`pn-fn-seed-multi`, `pn-ws-seed-multi`); the results are in "0.41.0-rc.1" below. Receive and history are modelled, not automated. |
| Held back | 11 of the send suite's 24 scenarios: 10 need a locked or broken-key private balance, and one waits on a finding. The `--created-tokens` sends hold back only that last one. |
| Official QA (`QA/QA*.md`) | On 2026-11-04 about 33 of its 756 numbered steps ran automatically (4%). Not recounted since: token creation, and sends of the created tokens, were added. |
| Funds | A send run gives its HTR and minted deposits back to genesis. Tokens created in the app keep their deposits (about 10 HTR each for the sends; up to the whole balance in the create run), and the create run isn't cleaned up. |
| Watching | Every flow is recorded with `screenrecord`, at no cost in time, into a playlist viewer with the steps beside the screen, long waits skipped, speeds and seeks on keys, and per-scenario validation marks. |

### Measured timings

| | |
|---|---|
| Setup of one wallet (fresh install, onboarding, mint, import) | about 3 min |
| A scenario that ends in an error | about 1.0 min |
| A scenario that sends | about 1.5 min |
| A failing scenario (a 60 s timeout) | about 2.2 min |
| Average per scenario, with the top-up and the return to the dashboard | about 1.3 min |
| Recording | about 10 MB a minute of video |
| Send suite | 22 min |
| Create token suite | 18 to 20 min |
| Sends of created tokens | 36 to 40 min |

## Findings

What the kit found in the app, still to decide unless marked settled.

- **The zero-HTR message of a private send.** `shielded.deposit.hide-amount.max.zero-htr` sends a whole deposit-token balance with Hide amount, from a wallet with no HTR. The graph expects "Insufficient HTR to cover the privacy fees of this transaction.", the message a Private send of 1.50 shows. The app shows "Insufficient HTR to cover this transaction and its fees.": wallet-lib throws "Token: 00. Insufficient amount of tokens to fill the amount." and `mapTxError` maps it to the generic message. That message looks misleading, since only the privacy fee needs HTR here. Which axis flips it, the whole balance or Hide amount, is untested. The graph's rule is unverified too, so either side may be the one to change. The runner holds the scenario back until this is decided; removing the check in `unrunnableReason` brings it back.

- **The deposit is rounded down on the amount screen and up everywhere else.** Filed as HathorNetwork/hathor-wallet-mobile#976, to decide whether and when to fix it. Both facades, reproduced on 0.41.0-rc.1; a regression from HathorNetwork/hathor-wallet-mobile#658, shipped since v0.32.0. The graph expects what the app does (`c-ct-rounding-*`, `c-ct-zero-htr-small-deposit-*`), so these scenarios pass; once the app is fixed they fail, and should expect `err-not-enough-htr`.
- **Settled: the message of a fee-token send with no HTR on the wallet service.** The graph was out of date. A wallet with shielded keys builds every send with the fullnode's engine (`usesSharedEngine` in wallet-lib), so it gives the fullnode's message; the rule now depends on the network, and the scenario passes. No issue filed: the message is right, if less precise than "Insufficient HTR to cover the network fee.", which wallets without shielded keys should still show (unit-tested, not run here). For locked and broken-key balances the old expectation stays, unverified.

## 0.41.0-rc.1: what is known (2026-11-24)

`qa/e2e` is `release-candidate` at `d33b1bbb` with `feat/e2e-testids` (`238b15dc`) merged in. One conflict, in `SendAddressInput.js`: the release wrapped Next in a view beside "Transfer between chains", so the `testID` moved onto the new Next.

| | |
|---|---|
| Verified | Dependencies install on Node 22, the patches apply, and `assembleE2e` builds (4 min 55 s cold). The graph's schema is valid. Send on `pn-fn-seed-multi`: 13 passed, 0 failed, 11 skipped, every scenario's status as in the 2026-11-04 run on 0.40.1; funds returned to genesis. |
| Create token | 12 of 12 pass on each facade. |
| Sends of created tokens | Fullnode: 16 passed, 1 held back. Wallet service: 16 passed, 1 held back, after the graph's rule was corrected (15 passed and 1 failed before). |
| Not run | Other areas and setups; send with minted tokens on the wallet service. |
| Weak spots | Sends to a shielded address are checked by the app's message only, not by what arrived. Send flows don't check the HTR the app shows. The facade check was never run against an app that fell back. Successful fee-token sends cover multisig (public) and shielded, not a simple address. |
| What was built | `createTokenFlow.js`, `--action`, `--unlocked` and `--created-tokens` in the runner, `testID`s on the creation screens and the token details, the wallet service on the privnet (profile `ws`) with a stand-in for its AWS queue, and checks that the app is on the wallet service and knows its HTR. |
| Traps met | Node 24, a System UI dialog on a fresh emulator, a Redis host that isn't a URL, no queue (the app never saw payments, and some passes were hollow), alerts sent to the real AWS, a check that could never pass, too few back presses. The README says how the ones of the checkout and of the wallet service are handled; on a fresh emulator, answer the System UI dialog with Wait before a run. |
| Jest, with the kit, before the creation `testID`s | 5 suites fail, 2 tests fail, 2376 pass. |
| Jest, plain `release-candidate` | The same 5 suites fail, 5 tests fail, 2229 pass: `App.test.tsx`, `nanoContracts/fixtures.js`, `historyNanoContract`, `registerNanoContract`, `reown`. |

Open questions:

- **`reown.test.js` fails differently**: 3 failing tests on plain `release-candidate`, a suite-level failure or a filtered-out error with the kit. The baseline had a symlinked `node_modules` and ran under load, so this may be the environment. Repeat it as README "Comparing Jest" says. The causes of the other four are not diagnosed either.
- **The version string doesn't identify the code.** PR 971 landed after the bump to `0.41.0-rc.1`, so builds with and without it show the same version in About, and no `v0.41.0-rc.1` tag was in the repo. Record the commit tested.
- **The e2e build is not the release binary**: it adds `testID`s, changes `src/sagas/featureToggle.js` and `src/App.js`, and allows plain HTTP to a local node. Store signing, the Play build and iOS need a check of their own.
- **The 4 `multichain*` flags are off** in `unleash/flags.json`, explicitly. The send run of 12:32 was before that, with them unlisted.
- **`tools/` has wallet-lib 4.3.0; the app has 4.4.0.** Untested whether it matters to funding and minting.
- **The graph lacks multichain**: 4 flags and 8 routes are in the code only. Out of scope of the regression run; tested by hand.

Next: receive and history, then register and unregister a token. Receive and history are modelled, but not listed for the privnet setups in the graph yet.

## Next steps for the held-back scenarios

1. Decide the finding on the zero-HTR message of a private send, then bring its scenario back.
2. Build the locked and broken-key private balances (phase 1 below), which brings back the other 10.

## Shortcomings

- **Selectors.** Screens no flow goes through yet have no `testID`s. The success modals and the import banner are still found by a point or by text (README "Selectors").
- **Two setups.** The privnet with a seed wallet, on either facade. The public testnets can't have their flags set (by rule) or their funds controlled; passkey setups need a ceremony the emulator can't do yet.
- **Unbuildable states.** A locked or broken-key private balance can't be set up yet, which skips 10 scenarios. Forcing a shielded-key mismatch, which both need, works only in a debug build, and runs now use the `e2e` build: these scenarios need a debug-build run, or a way to force the mismatch from outside the app.
- **Speed.** Each Maestro tap costs 1 to 3.5 s, mostly waiting for the screen to settle; the return to the dashboard takes about 10 s of back presses; every setup onboards a wallet from scratch.
- **Graph breadth.** The graph models 4 actions; the official QA covers about 30 to 40. A scenario can only be automated once its action is in the graph.
- **Clearing the address field.** The Send tab keeps the last address, and Maestro can't clear a multi-line field reliably, so the runner does it with adb (Ctrl+A, Delete).
- **Flakes.** Maestro's driver sometimes fails to start (retried once) or dies mid-flow (fails the scenario).
- **One machine.** Everything runs on one host, one emulator at a time.

## Roadmap

### Phase 1: a sturdier engine

- `testID`s for every element the flows touch, and flows that use them. Text stays for what a flow checks the user sees: the outcomes' messages. Done for the screens the current flows go through (README "Selectors").
- Runs on a release build with its JS in the APK: no Metro, no LogBox, no dev keys. Done: the `e2e` build type is the release build plus plain HTTP to a local node; the network settings are written as root on the emulator, not through `run-as`. It didn't make the scenarios faster: Maestro's waits dominate.
- A deep link, or the tab bar by id, to return to the dashboard.
- A failed scenario retried once on a fresh wallet, and flaky ones kept in a quarantine list.
- Setup for the locked and broken-key private balances.
- Faster taps: tune Maestro's wait for the screen to settle; a snapshot of the app after onboarding, so a setup costs seconds.

### Phase 2: the whole app on the privnet with the fullnode

Creating tokens is done. Model the remaining actions in the graph, then automate them: registering and unregistering tokens; receiving, private receives, unlocking and exporting the privacy keys; history; importing and resetting a wallet; settings, address mode, custom network; nano contracts (the privnet has them on). With small helpers: Reown (a WalletConnect client scripted in Node), biometry (`adb emu finger touch`), QR scanning (the emulator's virtual camera scene). Order to decide: by QA pain, by risk, or by reuse (create-token first, since other actions need tokens).

### Phase 3: the wallet-service facade locally

Done: compose profile `ws` (README "The wallet service"), from the public images. Create token and the sends of created tokens run on it; the send suite with minted tokens hasn't yet.

### Phase 4: CI

- **Shards.** A shard is one setup and a slice of its scenarios, with its own wallet and its own privnet: nothing is shared, so it scales close to linearly.
- **A merge job** collects the shards' results into one results file and one viewer.
- **Per PR**, the graph's impact tool picks the scenarios the change touches (typically 20 to 100: 5 to 10 min with shards). Nightly, everything.
- **Hosting the evidence**: a private bucket with signed links, or a tailnet machine that pulls the artifacts and serves them.

### Phase 5: reach

An iOS subset on macOS runners; a real-device farm for the timing checks on a low-end Android device; smoke runs on the public testnets with their flags as Unleash serves them and funds from a wallet we control.

### Likely to stay manual

Push notifications (real FCM), passkey ceremonies, app updates from the store, white-label builds, and judging the visual design.

## Estimates

The whole app is likely 600 to 1,200 scenarios; the graph will give the number once each action is modelled.

| 1,000 scenarios | Wall time |
|---|---|
| One emulator, today's speed | about 22 h |
| One emulator, after phase 1's speed work | about 10 to 12 h |
| 20 parallel runners | about 45 to 70 min |
| 50 parallel runners | about 25 to 35 min |
| A PR's picks with shards | about 5 to 10 min |

Cost of a full run, about 1,300 runner-minutes on Linux runners with KVM: free on GitHub's standard runners for a public repo, within the plan's limit of concurrent jobs; roughly $10 to $25 on larger or private-repo runners. iOS on macOS runners costs about 10 times more a minute, so a subset. A 16-core machine of our own runs about 4 emulators: a full run overnight in 4 to 6 h. Video is about 10 GB a full run at today's bitrate; half the resolution, or only failed and sampled scenarios, brings it to a few GB. These are estimates to check against current pricing and the org's plan.

The larger cost is people's time: modelling each action in the graph and writing its flow, about half a day to a day each with the infrastructure in place, so several weeks for the whole app. The viewer keeps that trustworthy: watch the suite once, then only what changed.

## Decisions to make

1. Runners: GitHub's free public-repo runners, a machine of our own, or both (ours nightly, the cloud for PRs and releases).
2. `testID`s land in the app's code in the official repo, which bears on RFC 0004 (HathorNetwork/rfcs PR 110) and where the kit lives.
3. Where the evidence is hosted.
4. The order of phase 2. Decided for now: receive and history, then registering and unregistering tokens. Multichain is tested by hand.
