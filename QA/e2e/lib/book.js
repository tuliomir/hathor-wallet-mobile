/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

// What the app should show, worked out from the payments a run made and not from the app.

// FEE_PER_AMOUNT_SHIELDED_OUTPUT and FEE_PER_FULL_SHIELDED_OUTPUT of wallet-lib, in cents.
const PRIVACY_FEE = { amount: 1n, full: 2n };
const NATIVE = '00';

/** Units as the app shows them: 123456n is "1,234.56". */
function shown(units) {
  const sign = units < 0n ? '-' : '';
  const digits = String(units < 0n ? -units : units).padStart(3, '0');
  return `${sign}${digits.slice(0, -2).replace(/\B(?=(\d{3})+$)/g, ',')}.${digits.slice(-2)}`;
}

/** Units of an amount the app shows. */
const units = (text) => BigInt(text.replace(/[,.]/g, ''));

/** The count of locked private outputs, as the token screen says it. */
const lockedCount = (count) => (count === 1
  ? '1 private output is locked' : `${count} private outputs are locked`);

/** How the app shortens a transaction's id in its details. */
const shortId = (txId) => `${txId.slice(0, 7)}...${txId.slice(-7)}`;

/**
 * The fees of a transaction, from the fullnode's own JSON of it: the total of its fee header in
 * HTR, the part its shielded outputs cost, and the rest.
 */
function feesOf(tx) {
  const total = (tx.fees || []).filter((entry) => entry.token_uid === NATIVE)
    .reduce((sum, entry) => sum + BigInt(entry.amount), 0n);
  const privacy = (tx.shielded_outputs || [])
    .reduce((sum, output) => sum + PRIVACY_FEE[output.asset_commitment ? 'full' : 'amount'], 0n);
  return { total, privacy, network: total - privacy };
}

/**
 * The row a transaction gets in a token's history.
 * @param {{ entry: string, uid: string, symbol: string, amount: bigint, fee: bigint }} tx `fee` is
 *   the HTR fee, when the wallet paid it
 */
function rowOf({ entry, uid, symbol, amount, fee, }) {
  const paid = uid === NATIVE && entry !== 'received' ? fee : 0n;
  const moved = { received: amount, sent: -amount, self: 0n }[entry] - paid;
  let description = `You sent ${symbol} to yourself`;
  if (moved > 0n) description = `Received ${symbol}`;
  if (moved < 0n) description = `Sent ${symbol}`;
  return { description, amount: shown(moved), moved };
}

module.exports = {
  shown, units, lockedCount, shortId, feesOf, rowOf, NATIVE,
};
