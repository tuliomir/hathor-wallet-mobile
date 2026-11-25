/**
 * @jest-environment node
 *
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, expect, it } from '@jest/globals';
import { nodesOf, mismatches } from '../../QA/e2e/lib/screen';

const XML = '<?xml version="1.0"?><hierarchy rotation="0">'
  + '<node index="0" text="3.00 HTR" resource-id="token-available-balance" class="x" bounds="[100,200][300,260]" />'
  + '<node index="1" text="Date &amp; Time &#10;x" resource-id="" class="x" bounds="[0,0][10,10]"></node></hierarchy>';

describe('the screen', () => {
  it('reads a dump: ids, unescaped texts and centres', () => {
    expect(nodesOf(XML)).toEqual([
      {
        id: 'token-available-balance', text: '3.00 HTR', x: 200, y: 230, height: 60,
      },
      {
        id: '', text: 'Date & Time \nx', x: 5, y: 5, height: 10,
      },
    ]);
    expect(nodesOf('ERROR: could not get idle state.')).toEqual([]);
  });

  it('says everything a dump lacks', () => {
    const nodes = nodesOf(XML);
    expect(mismatches(nodes, { 'token-available-balance': '3.00 HTR' }, { texts: [/^Date/], noIds: ['fees'], noTexts: ['x'] })).toEqual([]);
    expect(mismatches(nodes, { 'token-available-balance': '4.00 HTR', fees: '1' }, {
      texts: ['Public'], noIds: ['token-available-balance'], noTexts: [/Time/],
    })).toEqual([
      'token-available-balance reads "3.00 HTR", not "4.00 HTR"',
      'fees reads nothing (it is not on screen), not "1"',
      'the text Public does not show',
      'token-available-balance shows',
      'the text /Time/ shows',
    ]);
  });

  it('never takes an empty dump for a screen without the thing', () => {
    expect(mismatches([], {}, { texts: ['x'] })).toHaveLength(1);
  });
});
