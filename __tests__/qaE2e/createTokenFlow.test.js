/**
 * @jest-environment node
 *
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/* eslint-disable no-template-curly-in-string -- the app's messages carry ${placeholders} */
import { describe, expect, it } from '@jest/globals';
import YAML from 'yaml';
import { buildCreateTokenFlow, unrunnableReason } from '../../QA/e2e/lib/createTokenFlow';

const scenario = (values) => ({
  id: 'create-token:pn:x',
  values: {
    token: 'deposit', naming: 'valid', 'mint-amount': 'normal', funding: 'enough-htr', 'private-balance': 'unlocked', ...values,
  },
});
const TOKEN = { name: 'My Token', symbol: 'MYT' };
const OK = { id: 'ok-created', kind: 'success', at: 'confirm', message: '**${name}** created successfully' };
const error = (at, message = 'Next stays disabled') => ({ id: 'e', kind: 'error', at, message });
const steps = (values, outcome) => YAML.parseAllDocuments(
  buildCreateTokenFlow(scenario(values), outcome, TOKEN),
)[1].toJS().flatMap((group) => group.runFlow.commands);
const taps = (list) => list.map((s) => s.tapOn && s.tapOn.id).filter(Boolean);
const typed = (list) => list.map((s) => s.inputText).filter(Boolean);

describe('create-token flow', () => {
  it('goes through every step and reads the new token\'s configuration string', () => {
    const list = steps({}, OK);
    expect(taps(list)).toEqual([
      'tab-settings', 'create-token-type-deposit', 'create-token-name', 'create-token-name-next',
      'create-token-symbol', 'create-token-symbol-next', 'create-token-amount-next', 'create-token-confirm',
    ]);
    expect(typed(list)).toEqual(['My Token', 'MYT', '100.00']);
    expect(list).toContainEqual({ runFlow: '../enter_pin.yaml' });
    expect(list).toContainEqual({ extendedWaitUntil: { visible: 'My Token created successfully'.replace('My Token', '.*'), timeout: 60000 } });
    expect(list).toContainEqual({ copyTextFrom: { id: 'token-details-config' } });
  });

  it('checks the fee model and the fee of a fee token', () => {
    const list = steps({ token: 'fee' }, OK);
    expect(taps(list)).toContain('create-token-type-fee');
    expect(list).toContainEqual({ assertVisible: '0.01 HTR' });
    expect(list).toContainEqual({ assertVisible: 'Fee Model: Fee-Based' });
  });

  it('stops at the step whose Next stays disabled, without tapping it', () => {
    const name = steps({ naming: 'empty-name' }, error('name'));
    expect(typed(name)).toEqual([]);
    expect(taps(name)).not.toContain('create-token-name-next');
    expect(name[name.length - 1]).toEqual({ assertVisible: { id: 'create-token-name-next', enabled: false } });

    const symbol = steps({ naming: 'short-symbol' }, error('symbol'));
    expect(typed(symbol)).toEqual(['My Token', 'M']);
    expect(taps(symbol)).not.toContain('create-token-symbol-next');

    const amount = steps({ 'mint-amount': 'over-balance' }, error('amount', 'Next stays disabled and the deposit or fee shows in red'));
    expect(taps(amount)).not.toContain('create-token-amount-next');
    expect(amount[amount.length - 1]).toEqual({ assertVisible: { id: 'create-token-amount-next', enabled: false } });
  });

  it('works the amount out of the available HTR', () => {
    const script = (value) => steps({ 'mint-amount': value }, OK).find((s) => s.evalScript && s.evalScript.includes('output.amount')).evalScript;
    const amountFor = (value, text) => {
      const output = {};
      const maestro = { copiedText: text };
      // eslint-disable-next-line no-new-func
      new Function('output', 'maestro', script(value).replace(/^\$\{(.*)\}$/, '$1'))(output, maestro);
      return output.amount;
    };
    expect(amountFor('exact', 'You have 20.00 HTR available')).toBe('2000.00');
    expect(amountFor('over-balance', 'You have 1,020.50 HTR available')).toBe('102051.00');
    expect(amountFor('over-by-rounding', 'You have 20.00 HTR available')).toBe('2000.01');
  });

  it('checks the HTR the app shows before it types the amount', () => {
    const shows = (funding) => {
      const list = steps({ funding }, OK);
      const at = list.findIndex((s) => s.extendedWaitUntil && String(s.extendedWaitUntil.visible).startsWith('You have'));
      expect(at).toBeLessThan(list.findIndex((s) => s.inputText === '100.00'));
      return new RegExp(`^${list[at].extendedWaitUntil.visible}$`);
    };
    expect('You have 0.00 HTR available').toMatch(shows('zero-htr'));
    expect('You have 20.00 HTR available').not.toMatch(shows('zero-htr'));
    expect('You have 1,020.50 HTR available').toMatch(shows('enough-htr'));
    expect('You have 0.00 HTR available').not.toMatch(shows('enough-htr'));
  });

  it('enters the PIN, and expects the message after it, when the creation fails late', () => {
    const list = steps({ 'mint-amount': 'cents' }, error('authorize', 'Not enough HTR: ${required} required'));
    expect(list).toContainEqual({ runFlow: '../enter_pin.yaml' });
    expect(list[list.length - 1].extendedWaitUntil.visible).toBe('Not enough HTR: .* required');
  });
});

describe('unrunnableReason', () => {
  it('holds back the private balance states the kit can\'t set up', () => {
    expect(unrunnableReason(scenario({}))).toBeNull();
    expect(unrunnableReason(scenario({ 'private-balance': 'locked' }))).toMatch(/locked/);
  });
});
