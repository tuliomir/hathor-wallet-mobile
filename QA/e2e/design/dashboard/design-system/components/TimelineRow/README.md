# TimelineRow

One job on the plan timeline: estimate box, actual bar, hatched setup.

## Guidelines

- Real time axis: `scale` px per second, shared by every row.
- Estimate is an outline — solid when measured, dashed when guessed. Actual is a filled bar on top: `pass-fill` when done, `run` while running, `fail` when it failed.
- Wallet setup is hatched over the actual bar so it reads as work.
- The right column shows `actual / estimate  drift` for finished jobs.
- Queued rows after `now` are shifted by the drift so far.

Props: see `index.d.ts` (`TimelineRowProps`).
