# Run dashboard: design

The design of the live dashboard for a mobile e2e run (brief: `../claude-design-prompt.md`, sample data: `../sample-progress.json`). This folder is the repository copy of two design artifacts, kept in step with them.

| Path | What | Source of truth |
|---|---|---|
| `design-system/` | The design system: `README.md` (principles, voice, glyphs, layout, data and accessibility rules), `tokens.json` (colours in dark and light, type, spacing, radius, sizes), the `E2EDash` components (`components/bundle.js`, `bundle.css`, `index.d.ts`, one folder per component with guidelines and a preview) | [Design system “E2E Run Dashboard”](https://claude.ai/artifact/J3dbkNhzYjusqWeMhp2TcK) |
| `design-system/tokens.css` | CSS custom properties built from `tokens.json`. Generated: don't edit it | `node QA/e2e/design/dashboard/tools/build-tokens-css.mjs` |
| `screens/` | The screens: `canvas.json` (the canvas index: artboards, positions, notes) and one `*.dc.html` per artboard | [Design canvas “E2E run dashboard”](https://claude.ai/artifact/E29fGDkabPUMWWKY2mSkxh) |
| `screens/STATES.md` | Which artboard shows which of the brief's 11 states, at which width, and how far each is | this folder |
| `tools/` | Scripts that work on these files | this folder |

The `*.dc.html` files are design-canvas components: they render on the canvas, not opened on their own. The working page is `QA/e2e/dashboard/dashboard.html`, one HTML file with these tokens inlined; a change to the tokens or the components is copied there by hand.

## Keeping it up to date

Every change to the design system or the canvas is copied here in the same sitting, and pushed straight to `docs/e2e-dashboard-prompt` (no PR):

1. Change the artifact (design system or canvas).
2. Copy each changed file to the same path here: design-system `project/<path>` → `design-system/<path>`; canvas `project/<path>` → `screens/<path>`. Leave out `screens/ds/`, the canvas's copy of `tokens.json`.
3. If `tokens.json` changed, run `node QA/e2e/design/dashboard/tools/build-tokens-css.mjs`.
4. Update `screens/STATES.md` when an artboard is added, renamed or changes state.
5. Commit as `design(e2e-dashboard): <what changed>` and push.

A new screen is a new artboard on the canvas and a new `*.dc.html` here; a screen that changes is overwritten in place, so the folder always shows the current design and git keeps the history.

`design-system/.eslintrc.json` keeps the repository's lint off the component bundle, which is browser code written for the design-system page.
