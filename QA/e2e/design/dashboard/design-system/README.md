# E2E Run Dashboard

A calm instrument panel for one person watching a long mobile end-to-end test run. It answers four questions in three seconds, and only failure is allowed to be loud.

Source of truth: this design system and the design canvas “E2E run dashboard”. The repository mirrors both in `QA/e2e/design/dashboard/` on branch `docs/e2e-dashboard-prompt`; every change here is copied there in the same sitting (see that folder's README).

## What the page must answer, in this order

1. **Is it healthy?** Running, paused, finished, stuck, starting, offline.
2. **When will it end?** A clock time with a range, and how long from now. For a full run, the end of the *current part* first, the whole run second.
3. **What is it doing this second,** and is it taking longer than it should?
4. **Has anything failed,** and must I act now?
5. Why this run, and what the agent wants me to know. 6. What it doesn't cover. 7. What happened so far.

Questions 1–4 fit the first phone screen (390 × 844) without scrolling. On desktop they are the header, the needs-you strip and the three cards in the first row.

## Principles

- **Calm by default.** Dark ground (`surface-0`), panels (`surface-1`) separated by hairlines (`line`), not shadows. No gauges, gradients, confetti or decorative motion.
- **Failure is the only loud thing.** `fail` and `fail-bg` appear only when something failed. `needs` (amber) appears only when the person must act. `run` (teal) marks what is live. Everything else is ink on surface.
- **Colour never alone.** Every status carries a word or a glyph from the vocabulary below. A passed row's text stays `ink`; only its ✓ is `pass`.
- **Time, not counts.** Progress is drawn by time, because jobs differ a lot. Estimates show how they were made: a solid outline is measured, a dashed one is a guess, and a run made of guesses shows a wider range.
- **Setup is work.** Wallet setup is hatched (`hatch`) on every bar and row, so a 4-minute setup never reads as a stall.
- **Tag and result are separate.** *Why it's in this run* (tag: new, changed, failed, owed, fresh, stale app, skipped, or any future one) and *what happened* (result) are two elements, never one badge. An unknown tag renders as a plain chip with its legend text as its title.
- **Tabular figures** everywhere a time or count appears (`font-variant-numeric: tabular-nums`). Clock times are the viewer's local time, `HH:MM`; durations `m:ss` or `h:mm:ss`.

## Voice

Plain, short, specific. Say what to do, not what happened to the system.

- “Nothing needs you now.” — not “All systems nominal”.
- “Part 1 ends ≈ 16:29 · in 40 min · between 16:24 and 16:36.”
- “Half of it is guessed, so the range is wide.”
- “Stuck since 16:02: no event for 6 min (3× the longest usual gap).”
- Agent messages are shown verbatim, never reworded.

## Glyph vocabulary

| Glyph | Means | Colour token |
|---|---|---|
| ✓ | passed | `pass` |
| ↻✓ | passed on a retry (shows the try number) | `pass` + `needs` ring |
| ✕ | failed | `fail` |
| ▶ | running | `run` |
| ○ | queued | `ink-dim` |
| – | did not run (its wallet's setup broke) | `ink-dim` |
| ⊘ | skipped | `ink-dim` |
| ◐ | wallet setup | `ink-dim` + hatch |
| ■ | job finished | `ink-dim` |
| ◆ | finding (suspected app bug) | `finding` |
| ↺ | correction | `ink` |
| ! | needs you | `needs` |

Glyphs are text characters, `aria-hidden`, always next to the word.

## Layout

- **Desktop 1440:** content column `content-max` (1328px), side padding `space-14`. Order: header → pinned *why* and *correction* side by side → needs-you strip → three cards (When it ends · Now · Results) → plan timeline → scenario table → messages · not covered · log → PR summary.
- **Phone 390:** padding `space-4`. Order: header → needs-you + results line → When it ends → Now → (fold) → why/correction → plan → current job's scenarios → messages → not covered → log → copy summary.
- Panels: `surface-1`, `line` border, `radius-lg`, padding `space-5` (`space-4` phone). Eyebrow label first.

## Data rules

- Everything comes from `progress.json`; a missing field hides its element.
- Wallet seeds, PINs and full addresses never appear, not even in the log.
- When data stops arriving, the live pill becomes **Offline**, figures dim, and the time since the last update is shown. Old numbers are never shown as live.
- The page starts nothing. Commands appear as text to copy.

## Accessibility

- Text meets 4.5:1 in both themes (`ink-dim` on `surface-1` is ≥5.5:1); outlines and bars 3:1.
- Every control is a real button, input, select or link; focus ring 2px `link`.
- `/` focuses search, `f` jumps to failures.
- Motion only for something really happening (the running bar); none with reduced motion.

## Components

`E2EDash` (bundle global): StatusPill, ResultMark, TagChip, ScenarioId, TimeBar, Panel, NeedsYouCard, MessageCard, TimelineRow. Each has a preview and guidelines.
