# GOWA → Notification Bridge → OwlAgent

Integration guide for moving OwlAgent off Zernio onto the self-hosted WhatsApp stack:

```text
WhatsApp user
   │
   ▼
GOWA v8.11.0  https://notification.dev.lazyindra.online
   │  POST webhook  (every event, HMAC signed)
   ▼
Notification debug router  https://notification-debug.dev.lazyindra.online/webhook
   │  forwards the same request
   ▼
OwlAgent webhook  (your endpoint, configured in the router UI)

OwlAgent  ──POST /send/*  (Basic auth)──▶  https://notification.dev.lazyindra.online  ──▶  WhatsApp
```

The debug router is the single, maintained hop between the WhatsApp host and OwlAgent. You never point GOWA at OwlAgent directly, so routing changes stay in one place.

All request/response shapes below were read from `docs/openapi.yaml` and `docs/webhook-payload.md` in the pinned upstream checkout `aldinokemal/go-whatsapp-web-multidevice` tag `v8.11.0` (commit `ee029da`).

---

## 1. Register the inbound webhook (router UI)

1. Open <https://notification-debug.dev.lazyindra.online/>.
2. **Forward to**: your OwlAgent webhook URL, for example `https://owl.example.com/webhooks/whatsapp`.
3. **Method**: `POST`.
4. Click **Save route**.

The router's ingress is `https://notification-debug.dev.lazyindra.online/webhook`. GOWA is already pointed at it and every event GOWA emits lands there; the router forwards **all** of them.

As of this writing the router has no forward target saved, so arrivals are recorded but not delivered:

```json
{ "endpoint": "", "method": "" }
```

Saving a route starts forwarding. Check the current recording at any time with `GET /api/events`.

Same step over the API:

```bash
curl --fail-with-body --connect-timeout 5 --max-time 10 \
  -X POST 'https://notification-debug.dev.lazyindra.online/api/config' \
  -H 'content-type: application/json' \
  --data '{
    "endpoint": "https://owl.example.com/webhooks/whatsapp",
    "method": "POST"
  }'
```

Important: the router waits for your endpoint before it answers GOWA. Return **2xx immediately** from your handler and run the agent turn asynchronously afterwards. A 30-60 second LLM turn inside the webhook request is a queue stall.

Inspect what arrived at any time:

```bash
curl --fail-with-body 'https://notification-debug.dev.lazyindra.online/api/events'
```

---

## 2. Outbound send API

| Item | Value |
| --- | --- |
| Base URL | `https://notification.dev.lazyindra.online` |
| Auth | HTTP Basic, on every call |
| Device | `X-Device-Id: cds` |
| Reply-to | `phone` is a full WhatsApp JID: `628996926184@s.whatsapp.net` |

Read credentials from the environment, never from source control:

```bash
export NOTIF_URL='https://notification.dev.lazyindra.online'
export NOTIF_USER='<user>'
export NOTIF_PASS='<password>'
export DEVICE='cds'
```

The service implements Basic auth as its own guard. Send the `Authorization` header on every request:

```http
Authorization: Basic <base64(user:password)>
```

---

## 3. Send a text message

`POST /send/message`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `phone` | string | yes | WhatsApp JID, for example `628996926184@s.whatsapp.net` |
| `message` | string | yes | Message body |
| `reply_message_id` | string | no | Message ID to quote |
| `is_forwarded` | boolean | no | Forwarded label |
| `duration` | integer | no | Disappearing timer: `0`, `86400`, `604800`, `7776000` |
| `mentions` | string[] | no | Ghost mentions; `"@everyone"` mentions all group members |

```bash
curl --fail-with-body --connect-timeout 5 --max-time 10 \
  --user "$NOTIF_USER:$NOTIF_PASS" \
  -X POST "$NOTIF_URL/send/message" \
  -H 'content-type: application/json' \
  -H "x-device-id: $DEVICE" \
  --data '{
    "phone": "628996926184@s.whatsapp.net",
    "message": "asd",
    "is_forwarded": false
  }'
```

`200` response:

```json
{
  "code": "SUCCESS",
  "message": "Success",
  "results": {
    "message_id": "3EB0B430B6F8F1D0E053AC120E0A9E5C",
    "status": "<feature> success ...."
  }
}
```

Store `results.message_id`; you match it against `message.ack` receipts (section 8).

`400` returns the bad-request error object, `500` the internal error object.

---

## 4. Send files

All media endpoints are `multipart/form-data`. Send the binary **or** a URL, never both. Do not set `Content-Type` manually; the multipart boundary must come from the client.

### Image — `POST /send/image`

| Field | Type | Notes |
| --- | --- | --- |
| `phone` | string | required |
| `image` | binary | the file |
| `image_url` | string | alternative to `image` |
| `caption` | string | optional |
| `reply_message_id` | string | optional quote |
| `view_once` | boolean | optional |
| `compress` | boolean | optional |
| `is_forwarded`, `duration` | boolean, integer | optional |

```bash
curl --fail-with-body --connect-timeout 10 --max-time 60 \
  --user "$NOTIF_USER:$NOTIF_PASS" \
  -X POST "$NOTIF_URL/send/image" \
  -H "x-device-id: $DEVICE" \
  -F 'phone=628996926184@s.whatsapp.net' \
  -F 'caption=Today report' \
  -F 'image=@/tmp/chart.png'
```

### Document — `POST /send/file`

Fields: `phone`, `file` (binary) or `file_url`, `caption`, `reply_message_id`, `is_forwarded`, `duration`.

```bash
curl --fail-with-body --connect-timeout 10 --max-time 60 \
  --user "$NOTIF_USER:$NOTIF_PASS" \
  -X POST "$NOTIF_URL/send/file" \
  -H "x-device-id: $DEVICE" \
  -F 'phone=628996926184@s.whatsapp.net' \
  -F 'caption=Invoice' \
  -F 'file=@/tmp/invoice.pdf'
```

### Audio / voice note — `POST /send/audio`

Fields: `phone`, `audio` (binary) or `audio_url`, `ptt`, `reply_message_id`, `is_forwarded`, `duration`.

`ptt: true` sends a voice note and needs `ffmpeg` on the GOWA host to transcode to OGG Opus. Leave it false for a plain audio attachment.

```bash
curl --fail-with-body --connect-timeout 10 --max-time 60 \
  --user "$NOTIF_USER:$NOTIF_PASS" \
  -X POST "$NOTIF_URL/send/audio" \
  -H "x-device-id: $DEVICE" \
  -F 'phone=628996926184@s.whatsapp.net' \
  -F 'ptt=true' \
  -F 'audio=@/tmp/reply.ogg'
```

### Video and sticker

- `POST /send/video`: `phone`, `video` or `video_url`, `caption`, `reply_message_id`, `view_once`, `is_forwarded`, `duration`.
- `POST /send/sticker`: `phone`, `sticker` or `sticker_url`, `duration`, `is_forwarded`. jpg, jpeg, png, webp, gif; converted to WebP.

Every media endpoint answers with the same `SendResponse` as `/send/message`.

---

## 5. Typing indicator and presence

WhatsApp shows typing to the *contact*, so the endpoint takes the contact JID.

### Typing — `POST /send/chat-presence`

| Field | Type | Required | Values |
| --- | --- | --- | --- |
| `phone` | string | yes | contact JID |
| `action` | string | yes | `start` or `stop` |

```bash
# start typing
curl --fail-with-body --connect-timeout 5 --max-time 10 \
  --user "$NOTIF_USER:$NOTIF_PASS" \
  -X POST "$NOTIF_URL/send/chat-presence" \
  -H 'content-type: application/json' \
  -H "x-device-id: $DEVICE" \
  --data '{"phone":"628996926184@s.whatsapp.net","action":"start"}'

# stop typing
curl --fail-with-body --connect-timeout 5 --max-time 10 \
  --user "$NOTIF_USER:$NOTIF_PASS" \
  -X POST "$NOTIF_URL/send/chat-presence" \
  -H 'content-type: application/json' \
  -H "x-device-id: $DEVICE" \
  --data '{"phone":"628996926184@s.whatsapp.net","action":"stop"}'
```

WhatsApp's indicator expires after roughly 25 seconds. Re-issue `start` every ~20 seconds while the agent runs, then `stop` before sending the reply. Treat failures as non-fatal: a missing indicator must never fail a turn.

### Account presence — `POST /send/presence`

| Field | Type | Required | Values |
| --- | --- | --- | --- |
| `type` | string | yes | `available` or `unavailable` |
| `is_forwarded` | boolean | no | |

This marks the whole device online or offline, not a typing state for one chat. Default GOWA behaviour keeps the device `unavailable` so phone notifications keep working; do not force `available` as a background default.

---

## 6. Inbound webhook contract

GOWA posts one JSON object per event.

```json
{
  "event": "message",
  "device_id": "628123456789@s.whatsapp.net",
  "session_id": "org_2",
  "payload": {
    "id": "3EB0C127D7BACC83D6A1",
    "chat_id": "628987654321@s.whatsapp.net",
    "from": "628987654321@s.whatsapp.net",
    "from_lid": "251556368777322@lid",
    "from_name": "Customer",
    "timestamp": "2023-10-15T10:30:00Z",
    "is_from_me": false,
    "body": "Hello"
  }
}
```

`session_id` is present only when the JID maps to a registered session.

A real `message.ack` recorded by the router:

```json
{
  "device_id": "6285792071380@s.whatsapp.net",
  "event": "message.ack",
  "payload": {
    "chat_id": "239959873196218@lid",
    "from": "628996926184@s.whatsapp.net",
    "from_lid": "239959873196218@lid",
    "ids": ["3EB05DB7BF533B1CDA1492"],
    "receipt_type": "delivered",
    "receipt_type_description": "means the message was delivered to the device (but the user might not have noticed)."
  },
  "session_id": "cds",
  "timestamp": "2026-09-25T12:31:09Z"
}
```

Two things to read from it:

- `session_id` is the device slot (`cds`). That is the value for the `X-Device-Id` header when sending, not `device_id`, which is the WhatsApp account JID.
- `chat_id` can be an `@lid` privacy identifier (`239959873196218@lid`) even though `from` is a phone JID. Address replies with the phone JID form (`628996926184@s.whatsapp.net`), and treat an `@lid` value as an internal identifier, not something to send to directly.

Top-level `timestamp` is the event time; `payload.timestamp` (on `message` events) is the message time. Both are RFC3339.

### Signature

| Item | Value |
| --- | --- |
| Header | `X-Hub-Signature-256` |
| Format | `sha256=<hex hmac>`, the `sha256=` prefix is required |
| Algorithm | HMAC-SHA256 over the **raw** body |

```js
const crypto = require('crypto');

function verify(rawBody, header, secret) {
  const received = (header ?? '').replace('sha256=', '');
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(received, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
```

Keep the raw body bytes for this check. A re-serialized JSON body produces a different digest. Reject mismatches with `401`. The router forwards the GOWA headers unchanged, so the signature still validates after the extra hop.

### Handling order

1. Verify the signature.
2. Drop anything where `event !== "message"` (when you only want chat turns).
3. Drop `payload.is_from_me === true`. Without this you answer your own outbound messages and loop.
4. Deduplicate on `payload.id`.
5. Queue per sender using `payload.from`.
6. Persist `payload.chat_id` and the top-level `device_id` for later sends.
7. Answer `2xx` and process asynchronously.

### Event names GOWA can send

`message`, `message.reaction`, `message.revoked`, `message.edited`, `message.ack`, `message.deleted`, `chat_presence`, `group.participants`, `group.joined`, `label.edit`, `label.association`, `newsletter.joined`, `newsletter.left`, `newsletter.message`, `newsletter.mute`, `call.offer`.

The bridge is configured with an empty event filter, so all of them are forwarded. Filter on your side.

### Media in the payload

GOWA does not send Zernio's `attachments[]` array. Media arrives in a type-named field on `payload`:

| Kind | Field | Value |
| --- | --- | --- |
| Image | `image` | local path, or `{ path, caption }`, or `{ url, caption }` |
| Video | `video` | path or `{ path, caption }` |
| Audio / voice note | `audio` | local path |
| Document | `document` | `{ path, caption }` or `{ url, filename }` |
| Sticker | `sticker` | local path |

With `WHATSAPP_AUTO_DOWNLOAD_MEDIA` enabled the media is already on the GOWA disk as a `statics/media/...` path. With it disabled you get a WhatsApp CDN URL instead, so download immediately: those links expire. Captions also appear in `payload.body`.

---

## 7. Migration map from Zernio

| Zernio | Here | Note |
| --- | --- | --- |
| `POST <your>/webhooks/zernio` | router forwards to your endpoint | route is owned by the router UI |
| `X-Zernio-Signature`, hex, no prefix | `X-Hub-Signature-256`, `sha256=` prefix | strip the prefix before comparing |
| `event: "message.received"` | `event: "message"` | |
| `message.direction === "incoming"` | `payload.is_from_me === false` | loop protection |
| dedup on `payload.id` | dedup on `payload.id` | unchanged |
| `conversationId` | `payload.chat_id` | |
| `account.id` | top-level `device_id` | |
| `sender.phoneNumber` (`+E164`) | `payload.from` (`…@s.whatsapp.net`) | add or strip the JID suffix |
| `POST /inbox/conversations/{id}/messages` | `POST /send/message` | one call, no conversation id |
| multipart `attachment` | `/send/image`, `/send/file`, `/send/audio` | field is the media type name |
| `POST …/typing` | `POST /send/chat-presence` | `action: start` / `stop` |
| polling `GET …/messages` for `deliveryStatus` | `message.ack` webhook | push instead of poll |
| `POST /inbox/conversations` with a template | not available | see section 9 |

Delivery status: `message.ack` carries `payload.ids` (the message IDs, matching `results.message_id` from the send) and `payload.receipt_type` with values such as `delivered` and `read`, plus `payload.receipt_type_description`. Set `WHATSAPP_WEBHOOK_EVENTS` to include `message.ack` if your bridge filter is ever narrowed; today it forwards everything.

---

## 8. Endpoint index (v8.11.0)

| Endpoint | Purpose |
| --- | --- |
| `POST /send/message` | text |
| `POST /send/image` | image |
| `POST /send/audio` | audio, voice note with `ptt` |
| `POST /send/file` | document |
| `POST /send/video` | video |
| `POST /send/sticker` | sticker |
| `POST /send/contact` | contact card |
| `POST /send/link` | link with caption |
| `POST /send/location` | latitude, longitude |
| `POST /send/poll` | poll: `question`, `options`, `max_answer` |
| `POST /send/presence` | device online/offline |
| `POST /send/chat-presence` | typing indicator |
| `POST /message/{message_id}/revoke`, `/delete`, `/reaction`, `/update`, `POST /message/{message_id}/read` | message operations |
| `GET /devices/{device_id}/webhook`, `PATCH /devices/{device_id}/webhook` | per-device webhook config |
| `GET /devices/{device_id}/status` | connection state |

Device-scoped calls take `X-Device-Id` or `?device_id=`. When exactly one device is registered it is used as the default.

The OpenAPI document's own `info.version` still reads `8.9.0` while the repository tag is `v8.11.0`; the contracts above are from the tag.

---

## 9. Differences to plan around

- This is WhatsApp Web Multi-Device, not the Meta Cloud API. There are no Meta-approved templates and no template-send endpoint, so Zernio's template / 24-hour-window reopening flow has no direct equivalent here.
- Delivery tracking moves from polling to `message.ack` events. Persist sent message IDs and reconcile from the receipts.
- Media payload shape changed (section 6), so the attachment downloader needs rewriting.
- Identity mapping, entitlements, per-sender queues, reply splitting, retries, and failure messaging stay application-side. The bridge only transports HTTP.

## 10. Operational notes

- Put a timeout on every call: 10s for JSON, 30-60s for multipart uploads. An unbounded request eventually jams the sender queue.
- GOWA's `webhook_secret` signs the payload. Rotate it by `PATCH`ing `/devices/{device_id}/webhook` and updating both sides together.
- Secrets for this integration live in environment variables and the router secret store. They are deliberately not committed to this repository, which is public.