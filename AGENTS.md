# Agent instructions

## QA feature graph

`QA/graph/graph.yaml` is the map QA tests from: the wallet's features, feature flags, test axes, setups, and the path and expected messages of each action. Testers and tools read it to decide what to test after a change, so a graph that lags the code sends QA down the wrong paths.

A PR that adds or changes a feature, a flag, a screen, an axis value or a user-facing message updates the graph in the same PR.

Run the `qa-graph-check` skill (`.agents/skills/qa-graph-check/SKILL.md`) before opening any PR. Schema and commands: `QA/graph/README.md`.

## End-to-end tests

`npm run e2e:dev` runs, on an Android emulator and a local network, the scenarios your change reaches: minutes, not the hours of everything. Run it before opening a PR that touches `src/`, and after each change while you write tests. Follow the `e2e-suite` skill (`.agents/skills/e2e-suite/SKILL.md`), which also says how to run it for a branch that lacks `QA/e2e/`. Every suite run prints a live dashboard link: give it to the person you work for.
