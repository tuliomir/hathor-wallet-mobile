#!/usr/bin/env node
/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

// A stand-in for the wallet service's AWS queue of new transactions. The daemon sends each
// wallet's transaction to the queue (SQS SendMessage); on AWS the queue invokes the lambda that
// pushes it to the wallet's websocket. Here this server invokes that lambda itself, on
// serverless-offline's lambda port. Without it the app on the wallet service never hears of a
// payment it receives while it is open.

const crypto = require('crypto');
const http = require('http');

const PORT = process.env.PORT || 9324;
const LAMBDA_URL = process.env.LAMBDA_URL
  || 'http://ws-serverless:3002/2015-03-31/functions/hathor-wallet-service-dev-wsTxNotifyNew/invocations';

async function deliver(body, attempt = 1) {
  try {
    const response = await fetch(LAMBDA_URL, {
      method: 'POST', body: JSON.stringify({ Records: [{ body }] }),
    });
    const text = await response.text();
    if (response.ok && !text.includes('errorMessage')) {
      console.log(`delivered: ${body.slice(0, 120)}`);
      return;
    }
    throw new Error(`${response.status} ${text.slice(0, 300)}`);
  } catch (e) {
    console.log(`attempt ${attempt} failed: ${e.message}`);
    // SQS redelivers a message whose lambda failed.
    if (attempt < 5) setTimeout(() => deliver(body, attempt + 1), 1000 * attempt);
  }
}

http.createServer((req, res) => {
  let raw = '';
  req.on('data', (chunk) => { raw += chunk; });
  req.on('end', () => {
    const answer = (status, body) => {
      res.writeHead(status, { 'Content-Type': 'application/x-amz-json-1.0' });
      res.end(JSON.stringify(body));
    };
    if (req.headers['x-amz-target'] !== 'AmazonSQS.SendMessage') {
      answer(400, { __type: 'InvalidAction', message: 'only SendMessage' });
      return;
    }
    const { MessageBody } = JSON.parse(raw);
    // The SDK checks the MD5.
    const MD5OfMessageBody = crypto.createHash('md5').update(MessageBody).digest('hex');
    answer(200, { MessageId: crypto.randomUUID(), MD5OfMessageBody });
    deliver(MessageBody);
  });
}).listen(PORT, () => console.log(`queue stand-in on ${PORT}`));
