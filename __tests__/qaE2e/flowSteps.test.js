/**
 * @jest-environment node
 *
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/* eslint-disable no-template-curly-in-string -- Maestro's expressions and the app's messages */
import { describe, expect, it } from '@jest/globals';
import YAML from 'yaml';
import { buildSendFlow } from '../../QA/e2e/lib/sendFlow';
import { buildCreateTokenFlow } from '../../QA/e2e/lib/createTokenFlow';
import { reachedIn, BACK } from '../../QA/e2e/lib/flowSteps';

const ids = { id: 'x', values: { dest: 'simple', privacy: 'public', amount: 'normal', token: 'deposit', naming: 'valid', 'mint-amount': 'normal' } };
const sent = { id: 'ok-sent', kind: 'success', at: 'authorize', message: 'Sent ${amount}' };
const created = { id: 'ok-created', kind: 'success', at: 'confirm', message: 'created' };
const error = { id: 'err-x', kind: 'error', at: 'name', message: 'Next stays disabled' };
const token = { name: 'T', symbol: 'TTT' };
const groups = (flow) => YAML.parseAllDocuments(flow)[1].toJS().map((group) => group.runFlow);
const flows = (pinUrl) => [
  [groups(buildSendFlow(ids, sent, { address: 'W', token, pinUrl })), sent],
  [groups(buildSendFlow(ids, { ...error, at: 'amount' }, { address: 'W', token, pinUrl })), error],
  [groups(buildCreateTokenFlow(ids, created, { ...token, pinUrl })), created],
  [groups(buildCreateTokenFlow(ids, error, { ...token, pinUrl })), error],
];

describe('the end of a scenario\'s flow', () => {
  it('marks the outcome as reached after every check, then goes back to the dashboard', () => {
    flows().forEach(([list, outcome]) => {
      const back = list.pop();
      expect(back).toEqual({ label: BACK, commands: [{ runFlow: '../to_dashboard.yaml' }] });
      const commands = list.flatMap((group) => group.commands);
      expect(commands.pop()).toEqual({ evalScript: `\${console.log('E2E_REACHED ${outcome.id}')}` });
      expect(JSON.stringify(commands)).not.toContain('E2E_REACHED');
    });
  });

  it('finds the mark of that outcome only, and only when the flow logged it', () => {
    const line = '20:39:54.829 [ INFO] maestro.JsConsole: E2E_REACHED err-fee';
    expect(reachedIn(`a\n${line}\nb`, { id: 'err-fee' })).toBe(true);
    expect(reachedIn(line, { id: 'err' })).toBe(false);
    expect(reachedIn(line, { id: 'err-fee-2' })).toBe(false);
    // The command's own text, logged before it runs, is not the mark.
    expect(reachedIn('evalScript ${console.log(\'E2E_REACHED err-fee\')} RUNNING', { id: 'err-fee' })).toBe(false);
  });
});

describe('the PIN', () => {
  it('is tapped by Maestro when the runner does not serve it', () => {
    flows().filter(([, outcome]) => outcome.kind === 'success').forEach(([list]) => {
      const authorize = list.find(({ label }) => label.includes('authorize'));
      expect(authorize.commands).toEqual([{ runFlow: '../enter_pin.yaml' }]);
    });
  });

  it('is tapped by the runner after the first key, and the flow fails when that fails', () => {
    flows('http://127.0.0.1:1/').filter(([, outcome]) => outcome.kind === 'success').forEach(([list]) => {
      const [first, rest] = list.find(({ label }) => label.includes('authorize')).commands;
      expect(first).toEqual({ tapOn: { id: 'numpad-key-1' } });
      expect(rest.evalScript.script).toContain('http.post(\'http://127.0.0.1:1/\'');
      expect(rest.evalScript.script).toContain('if (!r.ok) throw');
    });
  });
});
