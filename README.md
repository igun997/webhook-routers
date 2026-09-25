# webhook-routers

A single webhook ingress that records every incoming request and forwards it to one endpoint using a method you choose.

## Run

```bash
npm install
npm start            # http://localhost:3000
```

Or with Docker:

```bash
docker build -t webhook-router .
docker run -p 3000:3000 webhook-router
```

## Use

1. Open `http://localhost:3000`.
2. Enter the target endpoint and the method the target expects, then save the route.
3. Point your webhook provider at `http://<host>:3000/webhook`.

Every call to `/webhook` is stored and forwarded to the saved endpoint with the saved method. The body is passed through byte for byte; request headers are forwarded except `host`, `content-length`, and `transfer-encoding`. The original response of the target is not returned to the caller; the router answers `202 {"forwarded":true}` so the provider is not blocked by a slow target. A failing forward records the error and answers `502`. With no route saved, the request is recorded and answered `409`.

## API

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/config` | Current route, or empty fields when unset |
| `POST` | `/api/config` | Save `{ "endpoint": "https://…", "method": "POST" }` |
| `GET` | `/api/events` | Recorded requests, newest first |
| `DELETE` | `/api/events` | Drop all recorded requests |
| any | `/webhook` | Ingress |

## Notes

- Route and requests live in memory; restarting clears both, and only the last 100 requests are kept.
- `PORT` sets the listen port (default `3000`).

## Test

```bash
npm test
```

## Integration guide

Migrating OwlAgent off Zernio onto the self-hosted WhatsApp stack (GOWA v8.11.0 → this router → OwlAgent, plus the outbound `/send/*` contract): see [`docs/gowa-whatsapp-bridge.md`](docs/gowa-whatsapp-bridge.md).