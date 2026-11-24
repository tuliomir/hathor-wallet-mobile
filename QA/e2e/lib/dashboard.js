/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The HTR the dashboard shows, in cents, from a uiautomator dump; null when the dump isn't of the
 * dashboard's token list. The list's first row reads "Hathor", the balance, "HTR".
 */
function htrOnDashboard(xml) {
  const texts = [...xml.matchAll(/ text="([^"]*)"/g)].map((match) => match[1]);
  const at = texts.findIndex((text, i) => (
    text === 'Hathor' && /^[0-9][0-9,]*\.[0-9]{2}$/.test(texts[i + 1]) && texts[i + 2] === 'HTR'));
  return at < 0 ? null : BigInt(texts[at + 1].replace(/[,.]/g, ''));
}

/** The centre of each key of the app's keypad, by digit, from Maestro's hierarchy. */
function numpadKeys(hierarchy) {
  const bounds = String.raw`"bounds" : "\[(\d+),(\d+)\]\[(\d+),(\d+)\]"`;
  const pattern = new RegExp(`"resource-id" : "numpad-key-([0-9])"[^}]*?${bounds}`, 'g');
  const middle = (a, b) => String(Math.round((Number(a) + Number(b)) / 2));
  return Object.fromEntries([...hierarchy.matchAll(pattern)].map(([, digit, x1, y1, x2, y2]) => (
    [digit, [middle(x1, x2), middle(y1, y2)]])));
}

module.exports = { htrOnDashboard, numpadKeys };
