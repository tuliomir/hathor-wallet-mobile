# TagChip

Why a scenario is in this run, as a neutral outlined chip.

## Guidelines

- Always neutral: tags explain, they don't judge. Colour belongs to the result.
- Pass the `tags` legend from progress.json; the legend line becomes the chip's title.
- A tag the legend doesn't know renders dashed with a fallback title — new tags need no page change.
- `count` turns it into a summary chip on a job row (`owed 21`).

Props: see `index.d.ts` (`TagChipProps`).
