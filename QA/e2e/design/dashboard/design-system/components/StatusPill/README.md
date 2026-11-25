# StatusPill

The run's state as one pill: a dot, a word and a colour that agree.

## Guidelines

- Lives in the header, first thing on the left; on phone, first in the top row.
- `running` is teal and its dot breathes (none with reduced motion). `paused` and `stuck` are amber with a square dot: they ask for the person. `failed` is the only red pill. `offline` has a hollow dot and dims the page.
- The consumer supplies the state from `run.state`, plus `stuck` / `offline` computed by the page.
- Never use it for a scenario result: that's ResultMark.

Props: see `index.d.ts` (`StatusPillProps`).
