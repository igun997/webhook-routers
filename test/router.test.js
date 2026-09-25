const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');
const { createApp } = require('../server');

async function listen(server) {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return server.address().port;
}

test('forwards the incoming webhook body to the configured endpoint with the configured method', async (t) => {
  let received;
  const target = http.createServer(async (request, response) => {
    const body = await new Promise((resolve) => {
      const chunks = [];
      request.on('data', (chunk) => chunks.push(chunk));
      request.on('end', () => resolve(Buffer.concat(chunks).toString()));
    });
    received = { method: request.method, body, source: request.headers['x-source'] };
    response.statusCode = 204;
    response.end();
  });
  const targetPort = await listen(target);
  t.after(() => target.close());

  const app = createApp();
  const router = http.createServer(app);
  const routerPort = await listen(router);
  t.after(() => router.close());

  const baseUrl = `http://127.0.0.1:${routerPort}`;
  const configResponse = await fetch(`${baseUrl}/api/config`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ endpoint: `http://127.0.0.1:${targetPort}/target`, method: 'PATCH' })
  });
  assert.equal(configResponse.status, 200);

  const webhookResponse = await fetch(`${baseUrl}/webhook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-source': 'test' },
    body: JSON.stringify({ event: 'created' })
  });

  assert.equal(webhookResponse.status, 202);
  assert.deepEqual(await webhookResponse.json(), { forwarded: true });
  assert.deepEqual(received, { method: 'PATCH', body: '{"event":"created"}', source: 'test' });

  const eventsResponse = await fetch(`${baseUrl}/api/events`);
  const [event] = await eventsResponse.json();
  assert.equal(event.status, 204);
  assert.equal(event.body, '{"event":"created"}');
});
