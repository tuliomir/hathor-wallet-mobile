/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

const http = require('http');
const { execFile } = require('child_process');

/**
 * The centre of each keypad key a flow tapped, by digit, from its Maestro log: Maestro found them
 * on the settled screen.
 */
function keysTapped(maestroLog) {
  const pattern = /Tapping on element: .*?resource-id=numpad-key-([0-9]),.*?bounds=\[(\d+),(\d+)\]\[(\d+),(\d+)\]/g;
  const middle = (a, b) => String(Math.round((Number(a) + Number(b)) / 2));
  return Object.fromEntries([...maestroLog.matchAll(pattern)].map(([, digit, x1, y1, x2, y2]) => (
    [digit, [middle(x1, x2), middle(y1, y2)]])));
}

/**
 * Serves the flows' scripts, which Maestro runs on this machine: each POST taps the PIN's digits
 * after the first. A key adds to the digits the app has rendered, so the taps leave it time.
 *
 * @param {string} adb its path
 * @param {string} pin
 * @param {() => Object<string, string[]>} keys the keys' centres, by digit
 */
function startPinServer(adb, pin, keys) {
  const server = http.createServer((request, response) => {
    const taps = [...pin.slice(1)].map((digit) => `input tap ${keys()[digit].join(' ')}`).join('; sleep 0.3; ');
    execFile(adb, ['shell', taps], (error) => {
      response.writeHead(error ? 500 : 200);
      response.end(error ? error.message : 'ok');
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({
      url: `http://127.0.0.1:${server.address().port}/`,
      close: () => server.close(),
    }));
  });
}

module.exports = { keysTapped, startPinServer };
