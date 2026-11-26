# Mobile e2e on the local privnet

Runs the app's money paths end to end on an Android emulator against a local stand-in for the Shielded Testnet, with every feature flag under the test run's control. The scenarios to run come from the QA feature graph (`QA/graph/`). This kit is early and exploratory: names, ids and layout will change.

The host setup (KVM, JDK 17, NDK, Maestro, the AVD) and the Android and Maestro gotchas are in the `mobile-e2e-flows` kit's README, which this one grows out of.

## Which command to run

`npm run e2e:status` says where every scenario stands, in a second. The commands below start the privnet and the emulator, and build and install the app of this checkout's sources, when they have to. `-- --dry-run` after any of them lists what would run, why, and about how long it takes. All the options are at the top of `suite.js`.

Run tests through these commands: each run shows live on the run dashboard and prints its link ("Watching a run live"). `run.js` alone, or a flow through `maestro test`, still works, unwatched. Add `-- --why "<why this run>"` so the dashboard says why it is happening.

| Moment | Command | What runs |
|---|---|---|
| Iterating on the app or on a scenario | `npm run e2e:dev -- --quick`, or `-- --only <job>` | A sample of each job your change reaches, or the changed scenarios of the jobs named |
| Before opening a PR | `npm run e2e:dev` | Every scenario that is new, failed last, or whose own test changed; those of a changed feature, all on the fullnode and a sample on the wallet service; a sample of what else the change may reach |
| A branch without this kit | `bin/try-branch.sh`, called from its checkout | `dev`, for what that branch changes, in a sibling worktree where it's merged with the kit |
| Before a push | `npm run e2e:smoke` | A few scenarios of every job (`lib/smoke.js`) |
| Release QA; ending a change to the suite | `npm run e2e:full -- --minutes 110`, then with `--resume` too until it's done | Everything, on a clean tree, with no filter. Its results and `ledger.json` are committed |
| Done for now | `npm run e2e:down` | Gives back the funds of kept wallets; stops the emulator and the privnet |

**How it knows.** Each result goes to a ledger with what it was a result of: the scenario's flow, its expectation and checks, the files of every feature that reaches it, the app's other files and the rest of the kit (`lib/fingerprint.js`, by content, so branches and merges don't matter). `ledger.json` is committed, from the last full run; `evidence/ledger.local.json` has this machine's runs; the newest entry counts. A scenario is then *fresh*, *changed*, *failed*, *new*, or *owed*: something shared changed that may reach it (`lib/select.js`). What a run leaves out stays owed, and is printed, until a full run. A result on an app that wasn't built from the checkout's sources counts as failed.

**A wallet that's kept.** `dev` and `smoke` go on with the wallet the app holds when it fits (`run.js --reuse`), which spares 2 to 4 min of onboarding. What an unlocked wallet should show is then read again from its seed, not from the app. Scenarios that need a wallet with no HTR, a token of their own or another private balance state get a fresh one; the log says why. A failure on a reused wallet may come from an earlier scenario: `--fresh` tells.

**A full run** remembers the jobs it finished (`evidence/full.json`), so it can be stopped and resumed; it refuses to go on when the code changed in between. A job with failures counts as done; `--resume --retry` runs such jobs again, and the summary says which try each result is of. The first try's results file stays in `QA/graph/runs/` too.

## Layout

| Path | What it is |
|---|---|
| `privnet/` | docker compose: the shielded fullnode (host port 18083), the dev miner (18035), the fake Unleash (18042) and wallet-lib's integration-test helper for funding (13020). Blocks are weight 1, so the miner sits near idle. |
| `unleash/` | The fake Unleash: `server.js`, and `flags.json`, the flags it starts with (real testnet values, plus the shielded flags on, push and wallet service off). |
| `bin/flags.js` | Lists and sets the flags: `flags.js set fee-based-tokens.rollout=off --wait`. |
| `bin/fund.js` | Sends HTR from the genesis wallet to a public address: `fund.js W... 10.50`. Uses the helper's `POST /fund`; shielded addresses are refused. |
| `tools/` | A small Node package of its own (wallet-lib 4.3.0, ct-crypto-node 0.5.0; `npm install` there once). `wallet.js` derives the app wallet's addresses from its seed, gives a peer wallet's shielded address, mints custom tokens (`mint <address> <deposit\|fee> <name> <symbol> <units> <treasury-seed-file>`), pays any address of any token (`send`), reads what a seed holds (`balances`), gives a run's funds back to genesis (`cleanup <evidence dir>`), and sends private outputs (temporary, see below). |
| `suite.js`, `ledger.json` | The suites ("Which command to run"), and what each scenario passed with in the last full run. |
| `run.js` | The runner under them: the scenarios of one action on one setup, with a results file (`QA/graph/runs/`, or `--results <dir>`) and evidence in `evidence/` (git-ignored). Its options are at its top. |
| `bin/app-on-privnet.sh` | Points the app at the privnet before it starts, writing its storage as root. `--fresh` wipes it first. Refuses anything but an emulator: store builds share the app id, so a wipe on a phone would erase its wallet. |
| `lib/` | `sendFlow.js` and `createTokenFlow.js` turn a scenario into a Maestro flow, and `flowSteps.js` has the steps they share; `walletStart.js` writes the flows around starting the wallet; `pinServer.js` taps the PIN for a running flow; `affected.js` finds the scenarios a change reaches; `tokenPlan.js` says which token each send gets; `createdTokens.js` has what differs for tokens created in the app; `payAgain.js` pays again what came in the same second as another transaction; `unrunnable.js` says why a scenario can't run (the QR code registrations); `dashboard.js` reads the dashboard's HTR; `runOrder.js` orders a setup's scenarios; `jobs.js`, `plan.js`, `fingerprint.js`, `ledger.js`, `select.js` and `smoke.js` pick what a suite runs, and `app.js` brings up what it runs on; `screen.js` drives the app over adb, and `receiveScenarios.js`, `historyScenarios.js` and `registerScenarios.js` use it, with what the app should show in `book.js`; `recorder.js` records the screen; `timeline.js` turns Maestro's logs into the viewer's timeline. |
| `viewer/` | `viewer.html`, the run viewer; `bin/serve-viewer.js` serves the runs' viewers and the live dashboard. |
| `dashboard/` | `dashboard.html`, the live dashboard of suite runs ("Watching a run live"); `lib/progress.js` keeps the `progress.json` it reads, and `lib/live.js` its server and link. Its design: `design/dashboard/`. |
| `flows/` | Maestro flows. `onboard.yaml`: new wallet on the privnet, ending on the dashboard. `to_dashboard.yaml`: back to the dashboard from wherever a scenario ended. `enter_pin.yaml`: the PIN, by taps. |

## How the flags work

The e2e build and debug builds, on a local node (`localhost`, `127.0.0.1` or `10.0.2.2`), fetch their flags from the fake Unleash on port 18042 of that host, instead of the real Unleash (`getUnleashUrl` in `src/sagas/featureToggle.js`). The e2e build is told apart by the `-e2e` suffix its build type adds to the version, which a store user can't set. Store builds and public networks always read the real one: a public network's servers can misbehave with a flag on that they expect off.

The app fetches flags when it connects to a network and then every 15 s. Set flags before the app reaches the privnet and they apply from the start. A change mid-run takes up to 15 s; `--wait` returns once the app has fetched it.

`app-on-privnet.sh` writes the privnet into the app's storage before launch, so the app's very first flag fetch already goes to the fake Unleash. That keeps push notifications off from the start; with the e2e build's placeholder `google-services.json`, push on means an "Unexpected error" dialog. It also skips the Network Settings screens in setup.

## The wallet service

`docker compose --profile ws up -d` in `privnet/` adds the wallet service, from the public `:dev` images (`docker compose --profile ws pull` first: they move). A setup with `facade: wallet-service` (`pn-ws-seed-multi`) then runs on it. The runner checks the API before it starts, and after onboarding checks at the bottom of Settings that the app uses it: a failed start falls back to the fullnode without a word, and the app then ignores the wallet service for a day (`featureFlags:ignoreWalletServiceFlag` in its storage).

What the stack needs beyond wallet-lib's integration-test compose, which it comes from:

- **`REDIS_URL` must be a URL.** With a bare host name the API starts and works until a client opens the websocket, then dies (`connect ENOENT redis`).
- **The queue stand-in (`sqs/server.js`).** On AWS a queue carries new transactions from the daemon to the lambda that notifies the websocket. Without it the app never sees a payment that arrives while it's open, and every "not enough HTR" scenario passes for the wrong reason. So each scenario first checks the HTR the app itself shows: on the dashboard before a send, on the amount screen when creating a token. Stopping `sqs` after setup is a quick way to see that check fail.
- **AWS is mapped to localhost (`extra_hosts`).** The service sends its alerts to AWS, with fake keys. serverless-offline answers a delivered websocket message with 204 where the service expects 200, so it raises an alert each time.

`docker compose --profile ws down` to stop it; without the profile its containers stay.

## Create token, and sends of created tokens

`--action create-token` runs the creation scenarios: name, symbol, amount, deposit and fee, up to the details screen. A creation that works is checked on the fullnode by the uid in the configuration string. `--created-tokens` runs sends of a deposit and a fee token the run makes in the app. It pays the wallet exactly what each costs (10.00 and 0.01 HTR), so the wallet is left with no HTR, as the zero-HTR scenarios need; a `max` send gets a token of its own. Deposits of created tokens stay locked: the app's wallet keeps their authorities, and the cleanup doesn't melt them. `--unlocked` picks scenarios as if an unlocked private balance were the only one: it lists nothing of what it leaves out, so it's no baseline.

## Custom tokens and the run order

After onboarding, the runner mints three tokens straight to the app wallet, from a treasury wallet that keeps the authorities: `E2E Deposit` (E2ED, 1000 tokens), `E2E Large` (E2EL, a deposit token of exactly 2^40 units, used only for the over-limit amounts) and `E2E Fee` (E2EF, 1000 tokens, fee-based). A separate token keeps the 2^40 units out of the other deposit scenarios: a balance above 2^40 makes a private send of the whole balance fail the 2^40 limit before it reaches the fee check. The app then imports them from the dashboard banner. E2EL's 1% deposit locks about 110M HTR of the privnet's 1B genesis, which the cleanup below frees.

The scenarios of one private balance state share one wallet, so the order matters (`lib/runOrder.js`). The wallet starts with the tokens and no HTR, so the zero-HTR scenarios run first. The other scenarios each get 20 HTR first; failures run before successful sends, because failures spend nothing. The private over-limit check needs all 2^40 E2EL, so it runs before the public send that moves them.

## Cleanup: the run's funds go back to genesis

After the scenarios, even when the run stopped half-way, the runner gives back what it took (`cleanup` in `tools/wallet.js`): the app wallet and the peer send their deposit tokens to the treasury, which melts them and so frees their deposits, and all three send their HTR to the genesis address. Without it, E2EL's deposit would use up a privnet in about nine runs; with it, a run costs a few HTR: the fee-token fees, what the multisig destination received (the helper keeps its keys) and what the fee tokens hold (melting them frees nothing). Each step that fails is logged and the rest go on; `node QA/e2e/tools/wallet.js cleanup <evidence dir>` retries, and does nothing when there is nothing left. It refuses a `NODE_URL` off this machine. `--no-cleanup` keeps the funds, to look at the wallets after a run.

Both single-key destinations, `simple` and `shielded`, belong to the peer, a seed the runner holds (`peer.seed`), so what they receive comes back too.

## Watching a run

Every run records the emulator's screen through each flow but onboarding, whose screen shows the seed, with Android's own `screenrecord`: the device encodes, so a recording costs no time and is ready when the run ends (about 10 MB a minute). The run then writes `evidence/<run>/viewer.html`, the recordings as a playlist: the token import, then each scenario, in the order they ran, with the skipped ones listed and their reasons. Each recording plays beside its steps, the graph's (`1/4 address: type the simple address`, `2/4 amount: ...`, the expected outcome last) with their Maestro commands under them and the runner's own steps (a top-up, the adb taps that empty the address field) in italics. The running step is highlighted and captioned over the video; done ones get a tick or a cross; a click on a step seeks to it, and the strip under the video shows the steps and the long waits.

| Key | |
|---|---|
| `Q`, `S`, `W` | 1×, 1.5×, 2× |
| `←`, `→` | back, forward 5 s |
| `Space` | play, pause |
| `N`, `P` | next, previous recording |
| `L` | skip long waits, on or off |
| `V` | mark the scenario validated, or undo |

"Skip long waits" jumps over any stretch of more than 3 s where no command starts or ends (a wait for the app, the runner's sleeps), keeping a second at each end; seeking into one on purpose plays it. "Mark validated" keeps, in the browser, the version of the scenario's flow you watched: a hash of the generated flow, the same from run to run until the flow changes. The playlist marks scenarios validated or "changed since validated", and "Show: not validated, or changed since" plays only those, for a sample after a change.

The viewer is one HTML file with the run's data in it, and the recordings are files beside it, so it also works from a copy of them. To watch from another machine on the tailnet:

```bash
node QA/e2e/bin/serve-viewer.js &      # localhost:18090; serves only the viewers and the recordings
tailscale serve --bg 18090             # https://<this machine>.<tailnet>.ts.net/, tailnet only
```

The index there lists the runs. An evidence dir also holds the run's seeds and Maestro's logs, which `serve-viewer.js` doesn't serve, so copy only the viewer and the recordings when sharing a run. Runs from before onboarding stopped being recorded still show the seed: the server withholds their `onboard/screen.mp4`, but their `viewer.html` lists five of its words. `tailscale serve --https=443 off` stops it. Timing: the recording's first frame is taken from screenrecord's "Configuring recorder" line on the host clock, and Maestro times its commands on the host clock too; the steps match the screen to about 0.2 s. `--no-record` skips the recordings and the viewer.

## Watching a run live

Every `dev`, `smoke` and `full` run shows on a dashboard, live: whether it is healthy, when it ends (a clock time with a range), what it is doing this second, what failed and whether it can wait, why it runs, what it leaves owed, and its log. Its design, and the brief it answers, are in `design/dashboard/`.

```
dashboard: http://127.0.0.1:18090/live/  (run full-20261126-131500)
dashboard on the tailnet: https://<this machine>.<tailnet>.ts.net/live/
```

The suite prints those lines when the run starts. It starts `bin/serve-viewer.js` when nothing answers on port 18090 (`E2E_VIEWER_PORT` changes it), and leaves it running, for the finished run and the past ones, which the page's run picker opens read-only. The tailnet line shows when `tailscale serve --bg 18090` was set up on this machine, which lasts; without it, the suite says that command. The page only reads: it shows commands to copy and starts nothing.

How it works:

- `suite.js` keeps `evidence/live/<run>/progress.json` (`lib/progress.js`), rewritten on every event and every 2 s; the page reads it every 2 s. A full run keeps one id over all its parts.
- `run.js` reports what it does (a wallet's setup, each scenario and runner step) over an IPC channel only `suite.js` opens. Started alone, it reports nothing.
- An agent talks to the person watching: `--why "<text>"` when the run starts, then `node QA/e2e/suite.js say <note|finding|correction|why> "<text>" [--job fn/send] [--link <url>]` at any time, to the newest run or `--run <id>`. A correction shows as prominently as the why.
- Full addresses are shortened wherever they show; seeds and the PIN are never reported. The phone's screen isn't captured live, since it shows addresses: the recordings are in the job's viewer.

When the runner and the page agree:

- **Time left** is the estimate of what is left: each queued scenario's time, each wallet setup not started, and what the running ones have left of theirs. A scenario's time is what it last took (the ledger), or a guess of 60 s; a setup is what `SETUP` in `suite.js` says. The **range** is ±15% of the measured part, ±40% of the guessed and ±20% of the setups.
- **Drift** is, for each job done, how long it took against its estimate, and for the running one, its time so far against the estimate of what it finished. The page names the jobs that drifted by 30 s or more. Bars of jobs not started yet move by the drift so far.
- A **part** of a full run ends before the first job that would end after `--minutes`. The page plays that forward over the jobs left to say when this part ends and how many parts the rest takes; elapsed time leaves out the pauses between parts.
- **Stuck** is no event for 3 times the longest gap between events so far, and never less than 12 min (3 times a wallet's setup), unless the runner said a long silence was coming (a build blocks it for up to 10 min). **No word from the runner** is `progress.json` not rewritten for 15 s: the runner stopped. **Offline** is the page not reaching the server.

Fields added to the design's schema (`design/sample-progress.json`):

| Field | Meaning |
|---|---|
| `run.stuckAfterSeconds` | When no event for that long counts as stuck |
| `run.parts[]` | Each part's `n`, `startedAt` and `endedAt`, so elapsed leaves the pauses out |
| `run.part.minutes` | The part's `--minutes`, which the page plans the next parts with |
| `run.resume` | The command that goes on: a resume, or a retry of the failed jobs |
| `run.finishedAt`, `run.state: stopped` | When the run ended; `stopped` when it ended on an error or a signal |
| `run.notCovered` | What the run leaves owed: `owed`, `fresh` (left out as fresh), `byReason[]` (`reason`, `count`, `scenarios`), `clearedBy`, `notes` |
| `current.quietUntil` | A silence the runner announced (a build), which isn't stuck |
| `current.expectedSeconds` | What a build or boot phase usually takes |
| `current.step.text` | The runner step or flow running now |
| `job.estimateFrom`, `job.guessed` | `last run`, `guess` or `mixed`, and how many of its scenarios are guessed |
| `job.counts`, `job.viewer` | What `run.js` reported at the end, and the job's viewer, beside `/live/` |
| `job.status: did not finish` | `run.js` stopped in it |
| `group.scenarios`, `group.setupError`, `group.reused` | The group's size; why its setup broke; whether it went on with the app's wallet |
| `scenario.firstTry` | The first try's status and note, when the job ran a second time |
| `messages[].job`, `messages[].scenario`, `messages[].link` | What a message points at |
| `events[].type`, `events[].status` | The event's kind, which the log filters by, and a scenario's result |

## Private balance states

Each state (`unlocked`, `locked`, `broken-key`) gets a fresh wallet of its own, in that order. For the last two the runner pays the wallet a private output, stops the app, and replaces the encrypted scan key in the app's record (`tools/privateBalance.js`; `asyncstorage:access` in its storage, written as root). Then it starts the app, enters the PIN and checks the state on Receive.

| State | What the key becomes | What the app shows |
|---|---|---|
| `locked` | the wallet's own key, under another PIN | "Private receiving is locked"; the send screen counts the locked outputs and offers the unlock |
| `broken-key` | another wallet's key, under the PIN | "Private receiving is unavailable"; no privacy selector; nothing the wallet holds on its shielded spend addresses, public amounts included |

On the wallet service neither state exists: with such a record the app starts again on the fullnode. `--action start-wallet` checks that, on both facades.

On its lock screen the app never goes idle, so Maestro takes 30 to 50 s over each key there and `uiautomator` never answers. `unlock` in `run.js` reads the keys' places from one `maestro hierarchy`, which doesn't wait for idle, and taps them with adb.

A scenario the kit can't run goes in `unrunnableReason` (`lib/unrunnable.js`) with its reason, and every run lists it as skipped, with a way back in `ROADMAP.md` for each one. Today: registering a token by its QR code ("Registering tokens again").

## Receiving, payments and history

`receive` reads the address as text, QR code (decoded from a screenshot, `tools/qr.js`), share sheet and clipboard (pasted into Send), and compares them with the addresses derived from the seed outside the app, before and after New address. `receive-payment` pays the app from the run's payer: public or private, a token it knows or not, with the app open or closed. `history` makes a received, sent or self transaction outside the app, the last two with the app wallet's own seed, and reads its row, its details and its fees.

What the app should show comes from the payments themselves and from the fullnode's JSON (`lib/book.js`), never from the app. For a payment that must not show (a private one to a locked wallet, any to a private address with a broken key), the runner then makes a public one and waits for it: absence only counts once the app is seen to be up to date.

These run over adb, with no Maestro but to import a token: a screen is read in one dump (2.2 s) that answers all its checks (`screen.shows`), so a scenario takes 15 to 30 s, or about 70 s when the app is closed and opened again. Ask for everything a screen should show in one `shows`; one call per element took twice as long.

## Registering tokens again

`register-token` runs on the wallet the payments and history scenarios use, with E2ED and E2EF paid and imported, over adb. For each token it opens the token's details and checks the fee model against the token's version on the fullnode, and the configuration string against wallet-lib's; copies the string; unregisters the token, first tapping the confirmation with the switch off (nothing must happen), then with it on; registers it again through Settings > Register a token > Manual info, pasting the string; and checks the balance and the details again. The wallet ends as it started, so the next job can go on with it.

- **The copy is checked by the paste.** "Copied to clipboard!" shows for 1.5 s, less than one uiautomator dump takes, and Android's own preview of what was copied isn't in the dump. So the runner first has the app copy something else (a tap on the Receive address), and the string pasted on the manual screen must then be the token's.
- **Android's clipboard preview covers the Home tab** after a copy, until something else on screen is touched: the runner touches the QR code, then Home.
- **Buttons under the navigation bar.** Unregister token's button sits under Android's navigation bar, so a tap at its centre presses Home and leaves the app (ROADMAP "Findings"). The runner taps such buttons by their top edge (`press` in `lib/registerScenarios.js`).
- **The camera permission.** Register a token asks for the camera once per install, before the scanner; the runner allows it and goes on to Manual info.
- **By QR code** is in the graph and skipped: it needs the emulator's virtual camera to show the token's QR code (ROADMAP "Phase 2").

## Running less, and faster

- **`run.js` by hand:** `--affected` takes features, flags or axis values of the graph (`--affected shielded-send,token:fee`), and `--since origin/release-candidate` picks the features whose `files` changed since that ref, uncommitted ones included. Both use the graph's impact tool and combine with every other option; `--dry-run` shows the picks without running. The files no feature lists are named in the log: what they reach isn't in the run. `suite.js` does more with the same graph.
- **The PIN is tapped with adb.** Maestro takes about 2.4 s a key. A flow taps the first key, which waits for the screen to settle, and then calls the runner over HTTP from its script, which Maestro runs on this machine (`lib/pinServer.js`). The runner learns where the keys are from the log of the first flow of the run that enters the PIN, which taps them all.
- **The way back to the dashboard is in the scenario's own flow**, after its last check, which saves a Maestro start (8 to 9 s). The flow logs `E2E_REACHED <outcome>` right after that check: that mark, not the flow's exit code, says whether the scenario passed. It was seen failing, on a wrong message, and so was a PIN the server could not tap. A flow that fails before it is followed by `to_dashboard.yaml` on its own.
- **A `while: notVisible` loop ends 7 s late**: Maestro gives an element that shows that long to go away. `to_dashboard.yaml` looks with a 500 ms wait of its own instead. It looks before the first back too: a back on the dashboard leaves the app.

## Between scenarios

The Send tab keeps the last address typed, and a flow can't clear it reliably: `eraseText` deletes only what's before the cursor, and a tap can land mid-way through a 3-line shielded address. So before each scenario the runner taps into the field with adb and sends Ctrl+A, then Delete (`clearSendAddress` in `run.js`). Each flow then asserts that the field holds exactly the new address. Restarting the app instead also works, but takes about 1.5 min per scenario.

Maestro's on-device driver sometimes fails to start or dies under load (`MaestroDriverStartupException`, `DeviceServerDiedException`). The runner retries a flow once when the driver doesn't start. A crash during a flow still fails the scenario; re-run it with `--scenarios`. On a debug build, LogBox toasts ("Open debugger to view warnings") can also cover the tab bar.

## Temporary: private payments come from `tools/wallet.js send-private`

The funding helper's `POST /fund` (0.0.2) pays public addresses only: a shielded `K...` address gets a 500. Until it can pay a shielded address with a private output, `wallet.js send-private <address> <HTR> <amount|full>` does it: it funds a throwaway wallet through the helper, then sends from it with wallet-lib (the old kit's `sender.js`, moved here). When the helper gains that, use `/fund` instead and delete `sendPrivate`, its command, and `@hathor/ct-crypto-node` if nothing else needs it. The function's comment says the same.

## Selectors

Flows find what they tap, type into and read by the app's `testID`s (Maestro's `id:`, Android's resource-id), and check what the user should see by its text. A `testID` doesn't move with the layout, the screen size, the copy or the language; the outcomes' messages are what a scenario verifies, so they stay text.

- Ids are kebab-case, `<screen or component>-<element>`: `send-amount-next`, `transaction-privacy-done`. Repeated elements end in a stable key, never in translated text or user data: `numpad-key-1`, `privacy-mode-switch-hide_amount` (the app's mode), `new-words-word-3` (a position).
- A shared component takes a `testID` prop and puts it on its native view (`NewHathorButton`, `TokenBox`, `InputLabel`, `PrivacyModeSelector`); one shown once, whatever the screen, sets its own (`NumPad`, `PrivacyModeCard`).
- Put the id on a view that is on screen where a tap lands: Maestro taps an element's centre. The tab bar's buttons reach under Android's navigation bar, so the ids `tab-home`, `tab-send` and so on are on the tabs' icons, in a view kept with `collapsable={false}` so React Native doesn't flatten it away.
- A `<Text>` inside another `<Text>` is part of its parent on Android, with no view of its own, so its `testID` never shows: the dashboard banner's "Import tokens" link is found by its text.
- A modal's backdrop can't be tapped by id, since its centre is under the modal: the success modal after the backup check, which has no button, is closed with a tap at a screen point.

The runner reads ids too: it finds where to tap with adb (`centreOf` in `run.js`) from a uiautomator dump.

## The e2e build

Runs use the `e2e` build type (`android/app/build.gradle`): the release build, with its JS bundled and no dev mode, which may also talk plain HTTP to a node on the device or its host (`android/app/src/e2e`) and reads its flags from the fake Unleash there; a release build allows only HTTPS, and the privnet is plain HTTP. It needs no Metro, shows no LogBox toasts, and has no dev keys to trip on.

`app-on-privnet.sh` writes the app's storage as root (`adb root`), which the emulator allows on an image without Play Store (the `default` system image), so it works on a build that isn't debuggable. It stops if adb didn't get root, and it refuses anything but an emulator. A debug build with Metro still runs: the runner records which build it found in the results file.

## Preparing a checkout

On Node 22, the version CI runs (`.nvmrc`): with Node 24's npm 11, `npm ci` stops with `EUSAGE`, "Missing: @sentry/cli-linux-...@2.42.4 from lock file". The lockfile installs fine on Node 22; regenerating it for this is not needed.

```bash
npm ci && ./node_modules/.bin/allow-scripts
npx rn-nodeify --install stream,process,path,events,crypto,console,buffer,zlib --hack && npx patch-package
# What `make i18n` would generate; this step alone needs no gettext.
for l in da pt-br ru-ru; do mkdir -p src/locale/$l; npx ttag po2json locale/$l/texts.po > src/locale/$l/texts.po.json; done
(cd QA/e2e/tools && npm ci)
```

Run the first line alone and check that it worked before the rest: `rn-nodeify` and `patch-package` fail with unrelated-looking errors when `node_modules` is missing.

## Run by hand

`suite.js` does all of this; these are its steps.

```bash
export JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64 MAESTRO_CLI_NO_ANALYTICS=1 ANDROID_HOME=~/Android/Sdk
# The app: the checkout needs the placeholder android/app/google-services.json and the generated
# translations (src/locale/*/texts.po.json). Cold about 4 min, about 1.5 min after a JS change.
(cd android && ./gradlew assembleE2e -PreactNativeArchitectures=x86_64)
cd QA/e2e/privnet && docker compose up -d && cd ..
~/Android/Sdk/emulator/emulator -avd hnni -no-window -no-audio -no-snapshot -gpu swiftshader_indirect &
adb install -r ../../android/app/build/outputs/apk/e2e/app-e2e.apk
node run.js --setup pn-fn-seed-multi
```

To drive one flow by hand: `bin/app-on-privnet.sh --fresh`, then `~/.maestro/maestro/bin/maestro test flows/onboard.yaml`.

A pipeline or a trailing `ls` hides Gradle's exit code; look for `BUILD SUCCESSFUL` and the APK's date.

Always tear down afterwards, or the miner and the emulator keep the CPU busy: `adb emu kill` and `docker compose down` in `privnet/`. With a debug build, also stop Metro and close the React Native DevTools windows it opened (`close_devtools` in the `mobile-e2e-flows` kit).

## Traps

- **"System UI isn't responding"** on a fresh emulator covers the app and fails onboarding. `suite.js` waits 2 min after a boot and answers it with Wait; by hand, do the same.
- **The app on the emulator is older than the checkout.** `run.js` warns, and its results don't count as passes. `suite.js` rebuilds.

## Comparing Jest with the app's own failures

The app has failing Jest suites of its own, so a kit branch is judged against the same commit without the kit. What makes that comparison mislead:

- A filter for `●.*›` drops a suite that failed to run ("Test suite failed to run" has no `›`). Compare the `FAIL` lines and the `Tests:` line, and read each failing suite's error.
- A baseline worktree whose `node_modules` is a symlink, or a run while Gradle builds, is a different environment. Give the baseline its own `npm ci` and an idle machine.
- Run a single suite under `timeout 120`: `__tests__/sagas/reown.test.js` alone once ran for over 5 min without finishing (cause unknown; ROADMAP "0.41.0-rc.1").

## The graph's freshness check

`qa:graph:check` compares `<base>...HEAD`, so a kit branch that lacks the app's newer commits reports nothing about them. Merge the app's branch first, then use the last release as the base: `node QA/graph/tools/cli.js check --base origin/release`.
