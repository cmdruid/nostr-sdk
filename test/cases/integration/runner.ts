import '#/helpers/websocket-runtime.js'
/**
 * Integration Test Runner
 *
 * Orchestrates feature and failure integration tests.
 * Stress tests are run separately via: npm run test:stress
 */
import tape from 'tape'
import { setupTestEnvironment } from '#/helpers/setup.js'
import { resetPortCounter } from '#/helpers/test-context.js'

// Initialize test environment with global error handlers
setupTestEnvironment()

// Reset port counter for consistent port allocation
resetPortCounter(9100)

// ─────────────────────────────────────────────────────────────────
// Relay Tests
// ─────────────────────────────────────────────────────────────────
import relay_feature from './relay/feature.test.js'
import relay_failure from './relay/failure.test.js'

// ─────────────────────────────────────────────────────────────────
// Socket Tests
// ─────────────────────────────────────────────────────────────────
import socket_feature from './socket/feature.test.js'
import socket_failure from './socket/failure.test.js'

// ─────────────────────────────────────────────────────────────────
// Subscription Tests
// ─────────────────────────────────────────────────────────────────
import subscription_feature from './subscription/feature.test.js'
import subscription_failure from './subscription/failure.test.js'

// ─────────────────────────────────────────────────────────────────
// Client Tests
// ─────────────────────────────────────────────────────────────────
import client_feature from './client/feature.test.js'
import client_failure from './client/failure.test.js'

// ─────────────────────────────────────────────────────────────────
// Node Tests
// ─────────────────────────────────────────────────────────────────
import node_feature from './node/feature.test.js'
import node_failure from './node/failure.test.js'

// ═════════════════════════════════════════════════════════════════
// Feature Tests (Happy Path)
// ═════════════════════════════════════════════════════════════════

tape('Relay Feature Tests', async t => {
  await relay_feature(t)
  t.end()
})

tape('Socket Feature Tests', async t => {
  await socket_feature(t)
  t.end()
})

tape('Subscription Feature Tests', async t => {
  await subscription_feature(t)
  t.end()
})

tape('Client Feature Tests', async t => {
  await client_feature(t)
  t.end()
})

tape('Node Feature Tests', async t => {
  await node_feature(t)
  t.end()
})

// ═════════════════════════════════════════════════════════════════
// Failure Tests (Error Scenarios)
// ═════════════════════════════════════════════════════════════════

tape('Relay Failure Tests', async t => {
  await relay_failure(t)
  t.end()
})

tape('Socket Failure Tests', async t => {
  await socket_failure(t)
  t.end()
})

tape('Subscription Failure Tests', async t => {
  await subscription_failure(t)
  t.end()
})

tape('Client Failure Tests', async t => {
  await client_failure(t)
  t.end()
})

tape('Node Failure Tests', async t => {
  await node_failure(t)
  t.end()
})

// ═════════════════════════════════════════════════════════════════
// Note: Stress tests are run separately via: npm run test:stress
// ═════════════════════════════════════════════════════════════════
