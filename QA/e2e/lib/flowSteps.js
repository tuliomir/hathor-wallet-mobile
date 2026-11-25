/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

// The steps the scenario flows share: the PIN, and the end of a scenario.

const REACHED = 'E2E_REACHED';
const BACK = 'runner: back to the dashboard for the next scenario';

/**
 * Enters the PIN. With `pinUrl`, Maestro taps only the first key, which waits for the screen to
 * settle, and then asks the runner to tap the others with adb (lib/pinServer.js): Maestro takes
 * about 2.4 s a key. Without it, Maestro taps them all.
 */
function pinSteps(pinUrl) {
  if (!pinUrl) return [{ runFlow: '../enter_pin.yaml' }];
  return [
    { tapOn: { id: 'numpad-key-1' } },
    {
      evalScript: {
        script: `\${(() => { const r = http.post('${pinUrl}', { body: '' }); if (!r.ok) throw new Error(r.body); })()}`,
        label: 'runner: tap the rest of the PIN (adb)',
      },
    },
  ];
}

/** The step, after a scenario's last check, that tells the runner it got there. */
const reachedStep = (outcome) => ({ evalScript: `\${console.log('${REACHED} ${outcome.id}')}` });

/** Whether a Maestro log has that mark. */
const reachedIn = (maestroLog, outcome) => new RegExp(`JsConsole: ${REACHED} ${outcome.id}$`, 'm').test(maestroLog);

/** Takes the app back to the dashboard in the scenario's own flow, sparing Maestro a start. */
const backGroup = () => ({ runFlow: { label: BACK, commands: [{ runFlow: '../to_dashboard.yaml' }] } });

module.exports = { pinSteps, reachedStep, reachedIn, backGroup, BACK };
