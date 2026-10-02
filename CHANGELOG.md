# CHANGELOG

## [1.0.2]

### Fixed
- Bound consecutive overflow reconnects until a subscription completes EOSE, and reject timeout results while received messages await verification.
- A caller-provided transport is replaced by a global WebSocket on reconnect; only the original URL is retained.
- Constructors validate WebSocket URL strings and positive receive limits; `send()` requires a connected or connecting transport.
- Empty filter objects match all events, while empty filter arrays match none. `listen()` rejects on cancellation/close instead of returning incomplete results.

- Browser timer compatibility and deferred queue cancellation on close.
- Immediate subscription timer cleanup on explicit close and persistent subscription recovery after remote disconnects.
- Reject unsolicited and filter-mismatched relay events before signature verification; remove relay-closed verification targets.
- Bound ordered verification batches and queued messages; disconnect overloaded relays without delivering unverified events.
- Reject incomplete queries on transport loss/overflow, allow reconnect after overload, and preserve subscriptions activated after a drop.
- Enforce per-filter historical limits locally without suppressing live events after EOSE.
- Preserve EVENT/EOSE ordering and match tag-filter values only at tag index 1.

### Build
- Include master pull requests in CI, preserve test failures, and build portable release packages.


## [1.0.1]

### Fixed
- Race condition in `NostrSubscription` keep-alive timer that could fire after cancellation
- Events from relays are now validated (signature verification) before being emitted

### Changed
- `EventCache` now uses secondary indexes for `kind` and `pubkey` fields, improving filter performance from O(n*m) to O(k) for simple queries

### Documentation
- Added entropy warning to `gen_seckey()` for optional seed parameter

## [1.0.0]

### Added
- `NostrNode` class now exported and production-ready for P2P encrypted RPC messaging
- MIT LICENSE file
- `docs/CONTRIBUTING.md` - Contribution guidelines
- `docs/ARCHITECTURE.md` - Architecture overview and diagrams

### Changed
- **Breaking:** Renamed `ready` getter to `is_ready` on `NostrClient` and `NostrNode` for API consistency
- **Breaking:** Error event signature changed from `[unknown, unknown]` to `[string]` on `NostrSocket`
- `assert_ok()` now throws for all falsy values, not just `false`
- `BaseRpcTemplate.version` is now optional (implementation uses protocol version constant)
- Improved `EventFilter` type safety with stricter index signature

### Fixed
- Race condition in `NostrSocket.connect()` when called concurrently
- Race condition in `NostrNode.connect()` when called concurrently
- Memory leak in `NostrSubscription.listen()` - event handlers now properly removed
- State machine in `NostrNode._on_cancel()` now correctly sets `_active` to false
- Error handling in `NostrNode._subscribe()` now properly emits errors on connection failure
- NIP-04 encryption documentation (clarified as deprecated, use NIP-44)
- Typo in encrypt.ts (`encryped` -> `encrypted`)

## [0.0.4]

- Fixed issues with event filtering and matching.
- Added more test cases.
- Added `test/config.ts` file for configuration.
- Made error responses more useful.
- Added documentation.

## [0.0.3]

- More fixes and improvements.
- Expanded test coverage.
- Updated dependencies.
- Updated documentation.

## [0.0.2]

- Numerous fixes and improvements.

## [0.0.1]

- Initial release.
