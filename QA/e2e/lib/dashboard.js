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

module.exports = { htrOnDashboard };
