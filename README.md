# @vbyte/nostr-sdk

[![npm version](https://img.shields.io/npm/v/@vbyte/nostr-sdk)](https://npmjs.com/package/@vbyte/nostr-sdk)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

A TypeScript SDK for the Nostr protocol.

## Features

- **Single relay connections** - `NostrSocket` for connecting to individual relays.
- **Multi-relay aggregation** - `NostrClient` for managing multiple relay connections.
- **Peer-to-peer communication** - `NostrNode` for encrypted RPC messaging between peers.
- **Health monitoring and keep-alive** - For socket connections and subscriptions.
- **Rate-limited message queuing** - Prevents spamming nodes with events (and getting banned from the relay).
- **Event de-duplication** - O(1) cache for filtering duplicate events from multiple subscriptions.
- **TypeScript-first** - Full type definitions included
- **Zod schema validation** - Runtime validation for events and messages

## Installation

```bash
npm install @vbyte/nostr-sdk
```

```bash
pnpm add @vbyte/nostr-sdk
```

**Note:** The `ws` package is a peer dependency for Node.js environments.

## Quick Start

### Connect to a Single Relay

```typescript
import { NostrSocket, CRYPTO, LIB } from '@vbyte/nostr-sdk'

// Create socket and connect
const socket = new NostrSocket('wss://relay.example.com')
await socket.connect()

// Generate keys
const seckey = CRYPTO.gen_seckey()
const pubkey = CRYPTO.get_pubkey(seckey)

// Create and sign an event
const template = LIB.create_event({
  kind: 1,
  content: 'Hello Nostr!',
  pubkey
})
const event = LIB.sign_event(template, seckey)

// Publish the event
await socket.publish(event)

// Close connection
socket.close()
```

### Subscribe to Events

```typescript
const sub = await socket.subscribe({ kinds: [1], limit: 10 })

sub.on('event', (event) => console.log(event))
```

### Query Events

```typescript
const events = await socket.query({ kinds: [1], limit: 10 })
console.log(events)
```

### Multi-Relay Client

```typescript
import { NostrClient } from '@vbyte/nostr-sdk'

const client = new NostrClient([
  'wss://relay1.example.com',
  'wss://relay2.example.com'
])
await client.connect()

// Publish to all relays (resolves on first success)
await client.publish(event)

// Subscribe with automatic deduplication
const sub = client.subscribe({ kinds: [1] })
sub.on('event', (event) => console.log(event))

// Close all connections
client.close()
```

### P2P Node

```typescript
import { NostrNode, CRYPTO } from '@vbyte/nostr-sdk'

// Generate keys for two peers
const aliceSecret = CRYPTO.gen_seckey()
const alicePubkey = CRYPTO.get_pubkey(aliceSecret)
const bobPubkey = '...' // Bob's public key

// Create node with peer list
const node = new NostrNode(
  [bobPubkey],                    // Peers to communicate with
  ['wss://relay.example.com'],    // Relay URLs
  aliceSecret                     // Your secret key
)

// Connect and start listening
await node.connect()

// Handle incoming messages
node.on('message', (msg) => {
  if (msg.type === 'request') {
    console.log(`Request from ${msg.event.pubkey}: ${msg.method}`)
    // Respond to requests
    node.respond(msg).accept({ result: 'ok' })
  }
})

// Send request to a peer
const response = await node.request(
  { method: 'ping' },
  bobPubkey,
  { timeout: 5000 }
)

// Broadcast to all peers
node.announce({ topic: 'status', data: { online: true } }, [bobPubkey])

// Close node
node.close()
```

## API Reference

### NostrSocket

Single WebSocket connection to a Nostr relay.

**Constructor**

```typescript
new NostrSocket(url: string, options?: Partial<NostrSocketConfig>)
```

**Options**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `max_retries` | `number` | `3` | Max reconnection attempts |
| `queue_ival` | `number` | `500` | Queue processing interval (ms) |
| `queue_limit` | `number` | `10` | Messages per queue batch |
| `msg_timeout` | `number` | `5000` | Message response timeout (ms) |
| `sub_timeout` | `number` | `30000` | Subscription EOSE timeout (ms) |

**Methods**

| Method | Returns | Description |
|--------|---------|-------------|
| `connect()` | `Promise<void>` | Establish connection |
| `publish(event)` | `Promise<PublishResponse>` | Publish signed event |
| `subscribe(filters)` | `NostrSubscription` | Create persistent subscription |
| `query(filters, duration?)` | `Promise<SignedEvent[]>` | One-shot event query |
| `close(delay?)` | `void` | Close connection |
| `send(msg)` | `void` | Send message via queue |

**Events**

| Event | Payload | Description |
|-------|---------|-------------|
| `ready` | `NostrSocket` | Connection established |
| `closed` | `NostrSocket` | Connection closed |
| `error` | `string` | Error occurred |
| `message` | `RelayMessage` | Relay message received |
| `notice` | `string` | NOTICE message from relay |
| `receipt` | `RelayReceiptMessage` | OK receipt for published event |

EVENT signatures and event IDs are verified before delivery to `message` or `event` listeners. Invalid events emit `reject`. Queries and persistent subscriptions also enforce their requested filters locally; they do not trust the relay to select matching events. This intentionally excludes invalid or unrelated responses that older releases could deliver. Control messages such as EOSE, NOTICE and OK keep their existing behavior.

Timer handling supports browser numeric handles and preserves Node.js `unref()` behavior when available.

### NostrClient

Multi-relay client with event deduplication.

**Constructor**

```typescript
new NostrClient(relays: string[], options?: Partial<NostrClientConfig>)
```

**Additional Options**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `cache_size` | `number` | `500` | Event deduplication cache size |

**Methods**

Same as `NostrSocket`, but operations are distributed across all relays:
- `connect()` - Resolves when first relay connects
- `publish(event)` - Resolves on first successful publish
- `query(filters, duration?)` - Resolves with first relay's response
- `subscribe(filter)` - Returns `SubscriptionManager` directly with deduplication
- `close()` - Closes all connections

### NostrNode

P2P communication node for encrypted RPC messaging over Nostr.

**Constructor**

```typescript
new NostrNode(
  peers: string[],                    // Public keys of peers
  relays: string[],                   // Relay URLs
  seckey: string,                     // Your secret key
  options?: Partial<NostrNodeConfig>
)
```

**Options**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `msg_timeout` | `number` | `5000` | Request timeout (ms) |
| `sub_timeout` | `number` | `30000` | Subscription timeout (ms) |
| `rpc_kind` | `number` | `25000` | Event kind for RPC messages |

**Properties**

| Property | Type | Description |
|----------|------|-------------|
| `is_ready` | `boolean` | Whether node is connected and active |
| `client` | `NostrClient` | Underlying multi-relay client |
| `peers` | `Set<string>` | Registered peer public keys |
| `pubkey` | `string` | Node's public key |

**Methods**

| Method | Returns | Description |
|--------|---------|-------------|
| `connect()` | `Promise<void>` | Connect and start listening |
| `request(template, peer, options?)` | `Promise<RpcMessageData>` | Send request and wait for response |
| `respond(request)` | `{ accept, reject }` | Create response to a request |
| `announce(template, peers)` | `Promise<void>[]` | Broadcast event to peers |
| `close()` | `void` | Close node and connections |

**Events**

| Event | Payload | Description |
|-------|---------|-------------|
| `ready` | `NostrNode` | Node connected and active |
| `closed` | `NostrNode` | Node closed |
| `error` | `[string, unknown]` | Error occurred |
| `message` | `RpcMessageData` | RPC message received |
| `bounced` | `SignedEvent` | Event failed decryption/filtering |
| `notice` | `string` | NOTICE from relay |

## Crypto Module

```typescript
import { CRYPTO } from '@vbyte/nostr-sdk'
// or
import * as CRYPTO from '@vbyte/nostr-sdk/crypto'
```

### Key Management

| Function | Description |
|----------|-------------|
| `gen_seckey(seed?)` | Generate secret key (optionally from seed) |
| `get_pubkey(seckey)` | Derive public key from secret key |
| `get_shared_secret(seckey, pubkey)` | Compute ECDH shared secret |

### Signatures

| Function | Description |
|----------|-------------|
| `create_signature(seckey, message)` | Create Schnorr signature |
| `verify_signature(message, pubkey, sig)` | Verify Schnorr signature |

### Encryption

| Function | Description |
|----------|-------------|
| `nip04_encrypt(secret, content, iv?)` | NIP-04 AES-CBC encryption |
| `nip04_decrypt(secret, content)` | NIP-04 AES-CBC decryption |
| `nip44_encrypt(secret, content, nonce?)` | NIP-44 ChaCha20 encryption |
| `nip44_decrypt(secret, payload)` | NIP-44 ChaCha20 decryption |

### Encoding

| Function | Description |
|----------|-------------|
| `encode_b64url(data)` | Encode bytes to base64url |
| `decode_b64url(str)` | Decode base64url to bytes |

## Library Module

```typescript
import { LIB } from '@vbyte/nostr-sdk'
// or
import * as LIB from '@vbyte/nostr-sdk/lib'
```

### Event Handling

| Function | Description |
|----------|-------------|
| `create_event(config)` | Create event template |
| `sign_event(template, seckey)` | Sign event with secret key |
| `verify_event(event)` | Verify event signature (returns error string or null) |
| `get_event_id(template)` | Compute event ID hash |
| `get_event_tag(event, tag)` | Get first tag by name |
| `filter_event_tags(event, tag)` | Get all tags by name |
| `is_pubkey_mentioned(event, pubkey)` | Check if pubkey is in 'p' tags |
| `is_event_expired(event, current?)` | Check if event has expired |

### Filtering

| Function | Description |
|----------|-------------|
| `match_filter(event, filter)` | Check if event matches filter |
| `match_any_filter(event, filters)` | Check if event matches any filter |
| `process_filters(events, filters)` | Filter event array |
| `is_kind_regular(kind)` | Check if kind is regular (1, 2, 4-44, 1000-9999) |
| `is_kind_replace(kind)` | Check if kind is replaceable (0, 3, 10000-19999) |
| `is_kind_ephemeral(kind)` | Check if kind is ephemeral (20000-29999) |
| `is_kind_address(kind)` | Check if kind is addressable (30000-39999) |

## Types

```typescript
import type {
  // Events
  SignedEvent,
  EventTemplate,
  EventFilter,
  EventConfig,

  // Configuration
  NostrSocketConfig,
  NostrClientConfig,
  NostrNodeConfig,

  // Responses
  PublishResponse,

  // RPC (for NostrNode)
  RpcMessageData,
  RequestRpcTemplate,
  EventRpcTemplate
} from '@vbyte/nostr-sdk'
```

## Development

### Requirements

- Node.js 18+ (20+ recommended)

### Setup

```bash
git clone https://github.com/cmdcode/nostr-sdk
cd nostr-sdk
npm install
```

### Scripts

| Command | Description |
|---------|-------------|
| `npm run check` | TypeScript type checking |
| `npm run lint` | Biome linting |
| `npm run lint:fix` | Auto-fix linting issues |
| `npm run format` | Format code with Biome |
| `npm run test` | Run test suite |
| `npm run build` | Build distribution |
| `npm run package` | Full pipeline (lint, check, test, build) |

### Build Outputs

- `dist/` - ES Modules with TypeScript declarations
- Organized by module: `class/`, `lib/`, `crypto/`, `schema/`, `types/`

## Resources

- [NIP-01: Basic Protocol](https://github.com/nostr-protocol/nips/blob/master/01.md)
- [NIP-04: Encrypted Direct Messages](https://github.com/nostr-protocol/nips/blob/master/04.md)
- [NIP-44: Versioned Encryption](https://github.com/nostr-protocol/nips/blob/master/44.md)
- [@noble/curves](https://github.com/paulmillr/noble-curves) - Cryptography
- [@noble/hashes](https://github.com/paulmillr/noble-hashes) - Hashing
- [@noble/ciphers](https://github.com/paulmillr/noble-ciphers) - Ciphers
- [Zod](https://zod.dev) - Schema validation

## Contributing

Contributions are welcome. Please open an issue or submit a pull request.

## License

[MIT License](LICENSE)

### 1.0.2 release preparation

The 1.0.2 source includes browser-safe timers, event signature verification before
consumer delivery, local subscription filters, and socket/queue teardown fixes.
Incoming EVENT messages must match a registered subscription (including temporary
queries) or a REQ sent through the socket. Unknown subscription IDs and mismatched
filters are discarded before signature verification; matching events still require
valid hashes and signatures before reaching message/event listeners or caches.
Explicit close drops pending sends and closes connecting as well as open transports.

This version metadata prepares a release. Publishing 1.0.2 and updating consuming
applications' dependency resolutions and lockfiles are separate required steps;
applications pinned to 1.0.1 continue to use that published implementation.


### Relay lifecycle and receive limits (1.0.2)

Explicit `close()` cancels subscriptions immediately and prevents reconnection.
A remote transport drop suspends persistent subscriptions and retries connection
up to `max_retries`, spaced by `queue_ival`; the same subscription resumes its
filters after reconnection. A relay `CLOSED` response terminates that request.

Incoming messages retain relay order, including EVENT before EOSE. Signature
verification yields between batches (`verify_batch`, default 16 messages per
turn). The queued backlog is capped (`receive_limit`, default 256); exceeding it
emits an error, rejects incomplete queries, and drops the transport. Started
persistent subscriptions reconnect within the same retry budget; repeated history
overflows exhaust that budget and cancel the subscription until explicitly restarted.
A processed EOSE resets the overflow retry budget. Callers may also
connect again explicitly. Applications querying unusually
large bursts can set a larger finite limit. Unsolicited or filter-mismatched
events are discarded before verification, while all delivered events remain
cryptographically verified.

Caller-provided WebSocket objects are used for the initial connection. Recovery
creates a new global `WebSocket` with the original URL; custom transport factories
and constructor options are not retained. Callers needing those must manage their
own replacement sockets. Constructors accept only `ws:`/`wss:` URLs and positive
finite `verify_batch`/`receive_limit` integers.

An empty filter object `{}` matches every event; an empty filter array `[]` matches
none. Filter timestamps include their boundaries (including zero), and tag filters
match tag index 1. Each filter's `limit` caps verified historical events before
EOSE; live events after EOSE are not capped. Overlapping OR filters share delivered
events, which count against every matching filter's remaining allowance.

A listener timeout rejects if received messages for that request are still waiting
for verification (for example in a throttled background tab). With no queued
messages, the existing timed-collection behavior still returns collected events.
