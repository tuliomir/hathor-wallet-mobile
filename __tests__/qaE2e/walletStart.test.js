/**
 * @jest-environment node
 *
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, expect, it } from '@jest/globals';
import YAML from 'yaml';
import { buildStartedFlow, buildServerFlow, buildImportFlow } from '../../QA/e2e/lib/walletStart';

const steps = (flow) => YAML.parseAllDocuments(flow)[1].toJS();

describe('wallet start flows', () => {
  it.each([
    ['locked', 'Private receiving is locked'],
    ['broken-key', 'Private receiving is unavailable'],
  ])('checks on Receive that the private balance is %s', (state, text) => {
    const list = steps(buildStartedFlow(state));
    expect(list).toContainEqual({ extendedWaitUntil: { visible: text, timeout: 60000 } });
  });

  it('only waits for the dashboard of an unlocked wallet', () => {
    expect(steps(buildStartedFlow('unlocked'))).toEqual([
      { extendedWaitUntil: { visible: 'Nano Contracts', timeout: 120000 } },
    ]);
  });

  it('looks for the facade\'s own server', () => {
    const server = (facade) => steps(buildServerFlow(facade))[1].scrollUntilVisible.element;
    expect('http://localhost:18300/dev/').toMatch(new RegExp(server('wallet-service')));
    expect('http://localhost:18083/v1a/').not.toMatch(new RegExp(server('wallet-service')));
    expect('http://localhost:18083/v1a/').toMatch(new RegExp(server('fullnode')));
  });

  it('imports every minted token, and expects exactly that many', () => {
    const list = steps(buildImportFlow(['E2E Deposit', 'E2E Own 01']));
    expect(list).toContainEqual({ extendedWaitUntil: { visible: 'Tokens found \\(2\\)', timeout: 30000 } });
    expect(list).toContainEqual({ tapOn: 'E2E Deposit' });
    expect(list).toContainEqual({ tapOn: 'E2E Own 01' });
  });
});
