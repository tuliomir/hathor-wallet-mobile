# MessageCard

A message from the agent, shown verbatim, styled by its kind.

## Guidelines

- `why` is pinned near the header; `correction` sits beside it at the same size — a correction is never smaller than what it corrects.
- `finding` (a suspected app bug) gets the violet ground so it can't be skimmed past; it is not a test failure and is never red.
- `note` is quiet ink-soft text.
- `target` links to the job or scenario row; `link` opens in a new tab.

Props: see `index.d.ts` (`MessageCardProps`).
