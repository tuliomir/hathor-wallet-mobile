/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

// Two transactions in the same second: the later one fails the fullnode's validation, as it must be
// at least a second after its parents. Nothing is wrong, so it is worth another try.
const SAME_SECOND = /full validation failed: tx=\w+ timestamp=(\d+), parent=\w+ timestamp=(\d+)/;

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

const isSameSecond = (error) => SAME_SECOND.test(error.message);

/** Runs `pay`, again after a pause when it only came too soon after another transaction. */
async function payAgain(pay, { tries = 4, pause = 1500 } = {}) {
  try {
    return await pay();
  } catch (e) {
    if (tries <= 1 || !isSameSecond(e)) throw e;
    await sleep(pause);
    return payAgain(pay, { tries: tries - 1, pause });
  }
}

module.exports = { payAgain };
