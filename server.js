const express = require('express');

const MAX_EVENTS = 100;
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

function decode(body) {
  if (!body || body.length === 0) return '';
  return body.toString('utf8');
}

function createApp() {
  const app = express();
  let config = null;
  let nextId = 1;
  const events = [];

  app.use('/webhook', express.raw({ type: () => true }));
  app.use(express.json());

  app.get('/api/config', (request, response) => {
    response.json(config ?? { endpoint: '', method: '' });
  });

  app.post('/api/config', (request, response) => {
    const { endpoint, method } = request.body ?? {};
    const normalized = String(method ?? '').toUpperCase();

    if (!endpoint || !METHODS.includes(normalized)) {
      response.status(400).json({ error: 'endpoint and a valid method are required' });
      return;
    }

    try {
      const url = new URL(endpoint);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('scheme');
    } catch {
      response.status(400).json({ error: 'endpoint must be an http(s) URL' });
      return;
    }

    config = { endpoint, method: normalized };
    response.json(config);
  });

  app.get('/api/events', (request, response) => {
    response.json(events);
  });

  app.delete('/api/events', (request, response) => {
    events.length = 0;
    response.status(204).end();
  });

  app.all('/webhook', async (request, response) => {
    const record = {
      id: nextId++,
      receivedAt: new Date().toISOString(),
      method: request.method,
      path: request.originalUrl,
      headers: request.headers,
      body: decode(request.body),
      forwardedTo: config?.endpoint ?? null,
      status: null,
      error: null
    };
    events.unshift(record);
    events.length = Math.min(events.length, MAX_EVENTS);

    if (!config) {
      record.error = 'no target endpoint configured';
      response.status(409).json({ error: record.error });
      return;
    }

    const headers = { ...request.headers };
    delete headers.host;
    delete headers['content-length'];
    delete headers['transfer-encoding'];

    try {
      const upstream = await fetch(config.endpoint, {
        method: config.method,
        headers,
        body: ['GET', 'HEAD'].includes(config.method)
          ? undefined
          : Buffer.from(record.body).length
            ? Buffer.from(record.body)
            : undefined
      });
      record.status = upstream.status;
      await upstream.arrayBuffer();
      response.status(202).json({ forwarded: true });
    } catch (error) {
      record.error = error.message;
      response.status(502).json({ error: error.message });
    }
  });

  app.use(express.static(require('node:path').join(__dirname, 'public')));

  return app;
}

module.exports = { createApp };

if (require.main === module) {
  const port = Number(process.env.PORT ?? 3000);
  createApp().listen(port, () => {
    console.log(`Webhook router listening on http://0.0.0.0:${port}`);
  });
}
