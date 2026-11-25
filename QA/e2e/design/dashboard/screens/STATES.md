# Screens by state

The brief's states, and the artboard that shows each. Phone is 390 px wide, desktop 1440 px. States 1, 3, 4 and 5 are drawn at both widths; the rest at either.

| # | State | Desktop | Phone | Status |
|---|---|---|---|---|
| 1 | Full run, healthy, 18% in (the sample) | `Main.dc.html` | `Phone.dc.html` | Drawn, reviewed |
| 2 | Full run, one broken setup behind 7 failures | — | — | To do |
| 3 | Full run paused between parts, waiting for a resume | — | — | To do |
| 4 | Stuck: one scenario at 4× its estimate, nothing for 6 min | — | — | To do |
| 5 | `dev` run, 18 of 179, 33 owed with reasons | — | — | To do |
| 6 | Finished, all passed, one job on its second try | — | — | To do |
| 7 | Finished with failures | — | — | To do |
| 8 | Lost connection to the data | — | — | To do |
| 9 | Starting up: build, emulator boot, no scenario yet | — | — | To do |
| 10 | A past run, read-only | — | — | To do |
| 11 | An unknown tag; a run where every estimate is a guess | — | — | To do |

New artboards are named `S<NN>-<state>-<desktop|phone>.dc.html` (for example `S03-paused-phone.dc.html`). State 1 keeps `Main` and `Phone`, because the canvas opens on `Main.dc.html`.
