/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Why the kit can't run a scenario, or null when it can. A reason given here lists the scenario
 * as skipped in every run, with its way back in ROADMAP.md.
 */
function unrunnableReason(scenario) {
  if (scenario.action === 'register-token' && scenario.values['register-by'] === 'qr') {
    return 'registering by QR code needs a camera helper: the emulator\'s virtual camera showing the token\'s QR code (ROADMAP "Phase 2")';
  }
  return null;
}

module.exports = { unrunnableReason };
