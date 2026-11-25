# Design a live dashboard for a mobile end-to-end test run

Design a monitoring page for one person, a senior QA engineer, who starts a long automated test run (from 4 minutes to 4.5 hours) and then does other work. They glance at it on a phone, or keep it open on a second screen. It replaces a chat where an agent says "about 3.5 h left" and nothing more.

`sample-progress.json`, in this same folder, is a snapshot of a real run. Use it as the page's data. Its queued tags, its messages and its current step are invented, to show states that run didn't have.

## The page must answer, in this order

1. **Is it healthy?** Running, paused, finished, or stuck.
2. **When will it end?** A clock time with a range, and how long that is from now.
3. **What is it doing this second,** and is that taking longer than it should?
4. **Has anything failed,** and do I have to act now or can it wait?
5. **Why is this run happening,** and what did the agent want me to know?
6. **What does this run not cover?**
7. **What happened so far?**

Questions 1 to 4 must be answerable in 3 seconds from the first phone screen, without scrolling.

## The domain

- A **run** has a mode, which decides how the page should feel:
  - `dev`: what a code change reaches; minutes to under an hour. What it leaves out matters most.
  - `smoke`: a few scenarios of everything, about 30 min.
  - `full`: everything, for a release; about 4.5 h, on one commit. It executes in **parts** of under 2 h, and waits between parts until someone resumes it. A pause is normal, and must not look like a crash.
- A run has **jobs** (14 in a full run), such as `fn/send`: one feature on one backend. `fn` is the fullnode and `ws` the wallet service. Jobs run one at a time, in order.
- A job has up to three **wallet groups**: `unlocked`, `locked`, `broken-key`. Each first spends 2 to 4 minutes **setting up** a new wallet, with no scenario result. Setup takes a large share of the time, so it must be visible as work and never look like a stall.
- A group has **scenarios** (1 to 24), each 15 to 120 seconds, each with named **steps** (`2/4 amount: pick E2ED, type the max amount`). Scenario ids are long and dotted (`simple.deposit.hide-amount.max.zero-htr.unlocked`); the parts are axis values, so find a way to make them scannable.

A scenario carries two independent things. Never merge them into one badge:

- **Its tag: why it is in this run,** or why not. `new`, `changed`, `failed` (last time), `owed` (something shared changed that may reach it), `fresh`, `stale app`, `skipped`. The data has a `tags` legend with a one-line meaning for each. More tags will come, so an unknown tag must render well, with its legend text, and no change to the page. `why` gives the reasons ("feature tx-history", "its checks").
- **Its result in this run:** `queued`, `running`, `passed`, `failed`, `did not run` (its wallet's setup broke), `skipped`. A result may be of a second try (`tries` on the job); a pass on a retry must look different from a clean pass.

## Content

1. **Header.** Run name, mode, state, commit and branch, whether the tree is clean, app build, when it started, part 1 of 3. A picker for past runs, which open read-only and say so.
2. **Progress and time.** Elapsed; remaining; the expected end as a clock time with a range; scenarios done of total; passed and failed so far. Show progress **by time**, not by scenario count: jobs differ a lot. Show the **drift**: how far ahead of or behind the first estimate, and which jobs caused it. Estimates come from measured last runs or from guesses (`estimateFrom`); a run made mostly of guesses must admit it with a wider range. When the run is in parts: when this part ends, and that the rest needs a resume.
3. **Now.** Job, group, scenario, step, what it expects to see, elapsed against expected with a bar that goes past 100%, and what comes next. **Stuck** means no event for 3 times the longest usual gap; say since when. Leave a place for a screenshot of the phone's screen (portrait, 9:20); it may be missing.
4. **Needs you.** Only when it applies, at the top: the part ended and waits for a resume; a job has failures; it looks stuck; a job didn't finish. Each with one line on what to do, and the exact command to copy.
5. **Messages from the agent.** Kinds: `why`, `note`, `finding` (a suspected bug in the app), `correction` (something the agent said before that was wrong). The `why` stays pinned near the header. A correction must be as prominent as what it corrects. A message may point at a job or scenario.
6. **Plan.** All jobs in order, as a timeline on a real time axis: estimated against actual, setup and scenarios told apart, "now" as a line. A job opens into its groups and scenarios, with result, tag, reasons, duration against estimate, and the note. Filter by result, tag, facade and wallet; search by id. 179 rows must stay usable.
7. **Failures.** What failed, what was expected against what the screen showed, its screenshot, a link to its recording, and whether failures look like **one cause**: 7 failures with the same note in a group whose setup broke are one problem, and should read as one.
8. **Not covered.** What this run leaves owed, grouped by reason, with counts, and what would clear it. In `dev` mode this is as important as the results.
9. **Log.** Everything that happened, newest first, with time; filter by job and by kind; a quiet "jump to latest" when new lines arrive while scrolled.

Beyond these: a visible "updated 4 s ago", and a clear state when the data stops arriving (the page must never show old numbers as live); the tab's title and icon carry state and percentage, so it reads from a tab strip; a summary block at the end, ready to paste into a PR.

## States to design

Use realistic content in each, not lorem ipsum:

1. Full run, healthy, 18% in (the sample).
2. Full run with a failure whose cause is one broken setup (7 scenarios).
3. Full run paused between parts, waiting for a resume.
4. Stuck: one scenario at 4 times its estimate, nothing for 6 minutes.
5. `dev` run of 18 scenarios of 179, with 33 owed and their reasons.
6. Finished, all passed, one job on its second try.
7. Finished with failures.
8. Lost connection to the data.
9. Starting up: building the app, booting the emulator, no scenario yet.
10. A past run, read-only.
11. An unknown tag, and a run where every estimate is a guess.

Show 1, 3, 4 and 5 on a phone (390 px) and on a desktop (1440 px), and the others at either size.

## Look

A calm instrument panel: dark by default, with a light theme; dense where it's a table, quiet everywhere else. Tabular figures for all times and counts. Colour carries meaning only, and never alone: pair it with a word or a shape, and check contrast (WCAG AA) in both themes. Failure must be the only loud thing on a healthy page. No decorative gauges, no confetti, no gradients. Motion only where something is really happening; respect reduced motion.

For reference, a sibling tool of mine uses near-black `#0f1115`, panels `#151922`, hairlines `#262c38`, text `#e6e8ec`, dim `#8d96a6`, links `#8cbcff`, amber `#ffd27a` for "needs you", pills for status, Inter, and a 1280 px column in this order: header with a live pill, needs-you cards, timeline, table, then messages beside follow-ups. Make this a relative of that page, not a copy.

## Constraints

- One self-contained HTML file: inline CSS and JS, no framework, no build, no external request. It's served on a private network by a small Node server beside a `progress.json`, which it reads every 2 seconds.
- The template holds no data of any run: everything comes from that JSON. Missing fields hide their element and break nothing.
- Read-only: it shows commands to copy and starts nothing.
- All links open in a new tab; the page itself stays open.
- Wallet seeds, PINs and full addresses never appear, not even in the log.
- Keyboard: every control reachable, visible focus, `/` to search, `f` to jump to failures.

## The data

`run` (mode, name, commit, branch, tree, app, startedAt, now, state: `starting | running | paused | finished`, part, selection), `current` (job, scenario, phase: `build | boot | setup | scenario | cleanup`, step, startedAt, lastEventAt), `tags` (the legend), `messages`, `jobs[]` (status, times, tries, estimateSeconds, `groups[]` with their setup times, `scenarios[]` with tag, why, status, times, note, expects, estimateSeconds, estimateFrom) and `events[]` (the log). The sample has all of these except `state: paused`, failures and owed lists. Where the design needs a field that isn't there, add it, and list every field you added with a one-line meaning: I'll make the test runner write it.

## Deliver

1. The page, working, with a switch between the states above that's easy to remove.
2. The states as sample JSON, in the schema you settled on.
3. The list of fields you added.
4. A short note on how the remaining time and its range are computed, how drift is, and when "stuck" starts, so the runner and the page agree.

Start with state 1 on a phone and on a desktop, and show me that before the rest.
