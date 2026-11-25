# ResultMark

A scenario's or job's result in this run: glyph and word, never colour alone.

## Guidelines

- Only the glyph carries colour for a pass; the word stays ink, so a page of passes stays calm.
- A failed mark is red and bold: the one loud thing.
- Pass `tries` from the job: a pass on try 2+ shows ↻ and an amber `try N` so it can't be mistaken for a clean pass.
- `did not run` means its wallet's setup broke; it is grey, not red — the failure belongs to the setup.

Props: see `index.d.ts` (`ResultMarkProps`).
