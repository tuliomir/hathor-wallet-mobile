#!/usr/bin/env node
/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

// Makes the app's wallet record start with its private balance locked or with a broken key, by
// replacing the encrypted scan key (ROADMAP "The path to no skipped scenarios").
//
//   privateBalance.js <locked|broken-key> <seed-file> <record-file>   prints the new record
//
// The record is the app's `asyncstorage:access` value. Write it back with the app stopped: the
// app reads its storage into memory when it starts.

const fs = require('fs');
// wallet-lib's own dependency, installed with it.
// eslint-disable-next-line import/no-extraneous-dependencies
const Mnemonic = require('bitcore-mnemonic');
const { Network, cryptoUtils, walletUtils } = require('@hathor/wallet-lib');

const PIN = '123456';
const OTHER_PIN = '999999';

const scanKey = (words) => new Mnemonic(words).toHDPrivateKey('', new Network('testnet'))
  .deriveChild("m/44'/280'/1'").deriveChild(0);

const [mode, seedFile, recordFile] = process.argv.slice(2);
if (!['locked', 'broken-key'].includes(mode) || !recordFile) {
  console.error('usage: privateBalance.js <locked|broken-key> <seed-file> <record-file>');
  process.exit(1);
}
const record = JSON.parse(fs.readFileSync(recordFile, 'utf8'));
const own = scanKey(fs.readFileSync(seedFile, 'utf8').trim());
if (own.xpubkey !== record.scanXpubkey) {
  console.error('the seed is not the record\'s');
  process.exit(1);
}
record.scanMainKey = mode === 'locked'
  ? cryptoUtils.encryptData(own.xprivkey, OTHER_PIN)
  : cryptoUtils.encryptData(scanKey(walletUtils.generateWalletWords()).xprivkey, PIN);
// wallet-lib keeps the process alive.
fs.writeSync(1, JSON.stringify(record));
process.exit(0);
