/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

// Reads the QR code on a screenshot (PNG) and prints what it says.
//
//   node qr.js <screenshot.png>

const fs = require('fs');
// Dependencies of this package alone, which the repo's lint doesn't install.
// eslint-disable-next-line import/no-unresolved, import/no-extraneous-dependencies
const { PNG } = require('pngjs');
// eslint-disable-next-line import/no-unresolved, import/no-extraneous-dependencies
const jsQR = require('jsqr');

const { data, width, height } = PNG.sync.read(fs.readFileSync(process.argv[2]));
const code = jsQR(new Uint8ClampedArray(data), width, height);
if (!code) {
  console.error('no QR code on the screenshot');
  process.exit(1);
}
console.log(code.data);
