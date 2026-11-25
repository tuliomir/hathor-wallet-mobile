# e2e roadmap: from the send scenarios to the whole app

Status on 2026-11-25, evening. The kit runs the QA graph's receive, receive-payment, history, send, create-token and start-wallet scenarios, in every private balance state, on the local privnet, with a seed wallet, on the fullnode and the wallet-service facades: 179 scenarios, all passing on `a1ce8fd1`, nothing skipped. It runs them on an Android emulator, records them, and shows them in a viewer for a person to check. Suites fit the moment: `dev` runs what a change reaches, `full` everything (README "Which command to run"). This file is where it stands, what holds it back, and the way to the whole app.

## Where it stands

| | |
|---|---|
| Graph | 44 features, 13 setups, 6 actions modelled (send, create-token, start-wallet, receive, receive-payment, history): 430 scenarios. Multichain isn't modelled. |
| Automated | Six actions on two setups (`pn-fn-seed-multi`, `pn-ws-seed-multi`): 179 scenarios, 14 jobs. The last full run is "Full run of 2026-11-25" below; `ledger.json` has what each scenario passed with. |
| Held back | Nothing. |
| Official QA (`QA/QA*.md`) | On 2026-11-04 about 33 of its 756 numbered steps ran automatically (4%). Not recounted since: token creation, and sends of the created tokens, were added. |
| Funds | A send run gives its HTR and minted deposits back to genesis. Tokens created in the app keep their deposits (about 10 HTR each for the sends; up to the whole balance in the create run), and the create run isn't cleaned up. |
| Watching | Every flow is recorded with `screenrecord`, at no cost in time, into a playlist viewer with the steps beside the screen, long waits skipped, speeds and seeks on keys, and per-scenario validation marks. |

### Measured timings

From the full run of 2026-11-25 (`a1ce8fd1`), 5 h 02 min in all.

| | |
|---|---|
| Setup of one wallet (fresh install, onboarding, tokens) | 2.5 to 4 min, once per private balance state; each token the app creates adds 1.7 min |
| A scenario, on average | 63 s over the whole suite. Sends 70 to 80 s; token creations 70 s; receive, payments and history 15 to 30 s, over adb (README "Receiving, payments and history"); a payment with the app closed and opened again about 65 s |
| Recording | about 10 MB a minute of video |
| Fullnode, by job | receive 9 min, payments 21, history 16, send 44, sends of created tokens 45, create token 32, start-wallet 9 |
| Wallet service, by job | receive 3 min, payments 14, history 7, send 38, sends of created tokens 35, create token 17, start-wallet 11 |
| `dev` for a change to one screen | 18 scenarios and 36 min for the transaction details, or 1 scenario and 8 min with `--quick`, a cold build included |

## Findings

What the kit found in the app, still to decide unless marked settled.

- **A fee-based token can't be created while all the wallet's HTR is private.** Seen in the app on 0.41.0-rc.1, fullnode: after a fully private 15.00 HTR payment, Create token for a fee token ends in "full validation failed: shielded balance equation does not hold" (screenshot: `evidence/fee-token-private-htr.png`, git-ignored). Reproduced in Node with wallet-lib 4.3.0 and 4.4.0, with amount-shielded and fully shielded HTR; a deposit token builds, and so does a fee token when the wallet also has public HTR. Not modelled in the graph yet: `funding` has no private-only value. The kit's payer and treasury are separate wallets because of it (`treasuryMinter` in `run.js`). Worth an issue in wallet-lib, and a message in the app instead of the raw error.
- **On the wallet service, a public payment of an unregistered token to the private address is offered for import only at the next start.** Seen on 0.41.0-rc.1: no banner, while a public payment made after it shows; after a restart the banner offers the token. wallet-lib's wallet-service `getTxBalance` looks only at the legacy addresses, and the app asks for the token list only when a shielded output pays it (`paysShieldedToWallet`, `src/sagas/wallet.js`). The graph expects it (`c-pay-ws-late-offer`). Private payments and payments to legacy addresses are offered at once.

- **With a broken key, the app hides public funds too.** Reproduced on 0.41.0-rc.1, fullnode, on 2026-11-25. A token created in the app is minted to one of the wallet's shielded spend addresses (`m/44'/280'/2'`), with its amount public. When the scan key in the app's record isn't the wallet's, wallet-lib doesn't use the record's shielded keys (`integrity: key-mismatch`), spend addresses included, so the whole token disappears: the Send screen says "0.00 E2EF available", and "Insufficient funds", while the fullnode has the 1000.00 unspent. Nothing on that screen says why; Receive says that private receiving is unavailable. A locked balance doesn't do this: there the created tokens can be sent. wallet-lib documents the repair, deriving the keys again from the words; not tried here. The tests expect what the app does (`lib/createdTokens.js`; the graph doesn't say where a token came from). Worth a question to the team: is a token missing from the balance, with no warning, what is wanted here? Not checked: whether the public change of a send can land on those addresses too.
- **Settled: the zero-HTR message of a private send.** The message depends on the amount. wallet-lib gives the privacy-fee error only when it would add a shielded change output, so a whole-balance private send from a wallet with no HTR gets "Insufficient HTR to cover this transaction and its fees.", and a partial one "Insufficient HTR to cover the privacy fees of this transaction.". Read in the code and seen in the runs; the graph says so (`c-send-zero-htr-private`, `c-send-zero-htr-private-max`).
- **The deposit is rounded down on the amount screen and up everywhere else.** Filed as HathorNetwork/hathor-wallet-mobile#976, to decide whether and when to fix it. Both facades, reproduced on 0.41.0-rc.1; a regression from HathorNetwork/hathor-wallet-mobile#658, shipped since v0.32.0. The graph expects what the app does (`c-ct-rounding-*`, `c-ct-zero-htr-small-deposit-*`), so these scenarios pass; once the app is fixed they fail, and should expect `err-not-enough-htr`.
- **Settled: the message of a fee-token send with no HTR on the wallet service.** The graph was out of date. A wallet with shielded keys builds every send with the fullnode's engine (`usesSharedEngine` in wallet-lib), so it gives the fullnode's message; the rule now depends on the network, and the scenario passes. No issue filed: the message is right, if less precise than "Insufficient HTR to cover the network fee.", which wallets without shielded keys should still show (unit-tested, not run here).

## 0.41.0-rc.1: what is known (2026-11-25)

`qa/e2e` is `release-candidate` at `d33b1bbb` with `feat/e2e-testids` (`238b15dc`) merged in. One conflict, in `SendAddressInput.js`: the release wrapped Next in a view beside "Transfer between chains", so the `testID` moved onto the new Next.

| | |
|---|---|
| Verified | Dependencies install on Node 22, the patches apply, and `assembleE2e` builds (4 min 55 s cold). The graph's schema is valid. Send on `pn-fn-seed-multi`: 13 passed, 0 failed, 11 skipped, every scenario's status as in the 2026-11-04 run on 0.40.1; funds returned to genesis. |
| Send, with minted tokens | Fullnode: 25 of 25. Wallet service: 24 of 24. |
| Create token | Fullnode: 20 of 20. Wallet service: 12 of 12. |
| Sends of created tokens | Fullnode: 19 of 19. Wallet service: 18 of 18. |
| Start wallet | 3 of 3 on each facade, the fallback of a locked and of a broken-key wallet to the fullnode among them. |
| Not run | Other areas and setups. |
| Weak spots | Sends to a shielded address are checked by the app's message only. In the minted-token runs the cleanup, which empties the peer, gave back exactly what most of those sends paid (1.50 HTR and the deposit tokens on both facades), but the runner doesn't assert it, and the fee tokens and the created-token runs have no such trace. The facade check was seen failing on an app that had fallen back. Successful fee-token sends cover multisig (public) and shielded, not a simple address. |
| What was built | A wallet per private balance state, with `tools/privateBalance.js`; the speed work (README "Running less, and faster"). Before that: `createTokenFlow.js`, `--action`, `--unlocked` and `--created-tokens` in the runner, `testID`s on the creation screens and the token details, the wallet service on the privnet (profile `ws`) with a stand-in for its AWS queue, and checks that the app is on the wallet service and knows its HTR. Before each send the runner reads the HTR on the dashboard (`lib/dashboard.js`): it waits for the top-up to show, or checks there is none. Seen failing as it should, with the queue stopped. |
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

## Full run of 2026-11-25

`a1ce8fd1`, `qa/e2e` (0.41.0-rc.1 with the kit), on a clean tree: 179 of 179 passed, nothing skipped, no retries. Fourteen results files in `QA/graph/runs/`, of 17:59 to 22:50 UTC, and `ledger.json`. A first start, at 16:31, was set aside after 57 scenarios (50 passed, 7 failed): the funding helper refused a transaction made in the same second as its parent, which broke one group's setup. `lib/payAgain.js` pays again in that case.

What the new checks were seen failing on, each by breaking what it guards: a payment's private and public parts swapped; the row's description; an amount one unit short; a fee one unit more; unblinding values expected of a public payment; a payment that shows where none must; the locked count off by one; the next address, the QR code and the clipboard each wrong; the wallet service's queue stopped. Not broken on purpose: the share sheet's text, the import banner, the order of the history, the date row. A commit of the work (`48a472e2`) says that each check was seen failing; that is the list.

### Next session

1. **The smoke rule** (`lib/smoke.js`) is a placeholder, for the owner to write.
2. **A dashboard of the running suite**, from the design prompt in `design/` (branch `docs/e2e-dashboard-prompt` on the fork). `suite.js` would write a `progress.json` it reads.
3. **Registering and unregistering tokens.**
4. Model a private-only `funding` for create-token, to keep the fee-token finding in the regression.

## Future possibilities

Things that would help, and that the kit can't do without a change to the app. None is planned.

### A switch in the e2e build to lock and unlock the private balance

**What can't be tested today.** An unlock that works. The runner locks a wallet by rewriting its record while the app is stopped, so that the PIN no longer opens the scan key. The app then keeps the record in memory, so nothing outside it can put the right key back while it runs: entering the PIN always fails. The scenarios therefore end at the request to unlock (`edge-locked-unlock`), and what follows a *successful* unlock is never run:

- the balance growing by what was locked, on the dashboard and on the token's screen;
- Receive going from "locked" to showing the private address;
- the send that was held up by the request to unlock going on to its end;
- creating a token after the unlock (while locked, it ends in an error).

**Why it matters.** This is the path a real user takes: a locked balance is a state to leave, and the app has its own code for leaving it (`HathorWallet.unlockShieldedView` and the balances and screens that refresh after it). A regression there would show funds as missing after a correct PIN, and only a manual test would see it.

**What it could be.** In the e2e build type only (told apart by its `-e2e` version suffix, as `getUnleashUrl` in `src/sagas/featureToggle.js` does), something the kit can call on the running app, such as a deep link or a flag of the fake Unleash, that drops the scan key from memory and leaves the record as it is. The wallet is then locked and the PIN opens it, which is the real state, with no storage edited. The runner would no longer need to restart the app for it, either.

**What it costs.** A few lines in the app that a store build must never reach, so a guard, a test for that guard, and a review by the team. That is why it waits: no changes to the app for now.

### The run's other limits

- **A `testID` on each screen a new flow goes through**: the kit's one standing need from the app.
- **Faster typing of addresses.** Maestro types a shielded address in about 15 s, the slowest step left in a send; adb could type it, from the same server that taps the PIN. Not tried, and it needs no change to the app.

## Shortcomings

- **Selectors.** Screens no flow goes through yet have no `testID`s. The success modals and the import banner are still found by a point or by text (README "Selectors").
- **Two setups.** The privnet with a seed wallet, on either facade. The public testnets can't have their flags set (by rule) or their funds controlled; passkey setups need a ceremony the emulator can't do yet.
- **Speed.** Each Maestro tap costs 1 to 3.5 s, mostly waiting for the screen to settle; a shielded address takes 15 s to type; every private balance state onboards a wallet from scratch. Screens driven over adb avoid the first; `--reuse` avoids the last while developing, not in a full run.
- **The origin of a token isn't in the graph.** Sends of created tokens are a mode of the runner, with the one expectation that differs kept in `lib/createdTokens.js`. An axis would show it on the graph, at the cost of more scenarios.
- **Graph breadth.** The graph models 6 actions; the official QA covers about 30 to 40. A scenario can only be automated once its action is in the graph.
- **Clearing the address field.** The Send tab keeps the last address, and Maestro can't clear a multi-line field reliably, so the runner does it with adb (Ctrl+A, Delete).
- **Flakes.** Maestro's driver sometimes fails to start (retried once) or dies mid-flow (fails the scenario).
- **One machine.** Everything runs on one host, one emulator at a time.

## Roadmap

### Phase 1: a sturdier engine

- `testID`s for every element the flows touch, and flows that use them. Text stays for what a flow checks the user sees: the outcomes' messages. Done for the screens the current flows go through (README "Selectors").
- Runs on a release build with its JS in the APK: no Metro, no LogBox, no dev keys. Done: the `e2e` build type is the release build plus plain HTTP to a local node; the network settings are written as root on the emulator, not through `run-as`. It didn't make the scenarios faster: Maestro's waits dominate.
- The PIN by adb, the way back inside the scenario's flow, and only the affected scenarios while developing. Done: about 19% off a scenario (README "Running less, and faster").
- A failed scenario retried once on a fresh wallet, and flaky ones kept in a quarantine list.
- Setup for the locked and broken-key private balances. Done (README "Private balance states").
- Faster taps: tune Maestro's wait for the screen to settle; a snapshot of the app after onboarding, so a setup costs seconds.

### Phase 2: the whole app on the privnet with the fullnode

Creating tokens, receiving, payments and history are done. Model the remaining actions in the graph, then automate them: registering and unregistering tokens; unlocking and exporting the privacy keys; importing and resetting a wallet; settings, address mode, custom network; nano contracts (the privnet has them on). With small helpers: Reown (a WalletConnect client scripted in Node), biometry (`adb emu finger touch`), QR scanning (the emulator's virtual camera scene). Order to decide: by QA pain, by risk, or by reuse (create-token first, since other actions need tokens).

### Phase 3: the wallet-service facade locally

Done: compose profile `ws` (README "The wallet service"), from the public images. Send, create token and the sends of created tokens run on it.

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
