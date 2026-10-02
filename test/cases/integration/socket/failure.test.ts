/**
 * Socket Failure Tests
 *
 * Error scenario tests validating that NostrSocket handles
 * failures and edge cases gracefully.
 */
import { Test }        from 'tape'
import { NostrRelay }  from '@/class/relay.js'
import { NostrSocket } from '@/class/socket.js'
import { TEST_PORTS, FAILURE_CONFIG } from '#/config.js'

import {
  wait_ms,
  create_test_event,
} from '#/cases/integration/helpers/fixtures.js'

export default async function socket_failure_tests (t: Test) {
  const relay = new NostrRelay()
  await relay.start({ port: TEST_PORTS.SOCKET.FAILURE })
  const url = `ws://localhost:${TEST_PORTS.SOCKET.FAILURE}`

  // ───────────────────────────────────────────────────────────────
  // Connection Failure Tests
  // ───────────────────────────────────────────────────────────────

  t.test('Socket Connection Failures', async st => {
    st.test('connect timeout to non-existent relay', async t => {
      const socket = new NostrSocket(FAILURE_CONFIG.INVALID_URL, {
        msg_timeout : FAILURE_CONFIG.SHORT_TIMEOUT
      })

      try {
        await socket.connect()
        t.fail('should have timed out')
      } catch (err: any) {
        t.ok(err.message || err, 'connection failed as expected')
      }

      socket.close()
      await wait_ms(100)
      t.end()
    })

    st.test('handles invalid URL', async t => {
      try {
        const socket = new NostrSocket('not-a-valid-url')
        await socket.connect()
        t.fail('should have rejected invalid URL')
      } catch (err: any) {
        t.ok(err.message || err, 'invalid URL rejected')
      }
      t.end()
    })

    st.test('handles connection while already connected', async t => {
      const socket = new NostrSocket(url)
      await socket.connect()
      t.ok(socket.is_ready, 'first connect succeeded')

      // Second connect should be a no-op or succeed
      await socket.connect()
      t.ok(socket.is_ready, 'still connected after second connect')

      socket.close()
      await wait_ms(100)
      t.end()
    })

    st.end()
  })

  // ───────────────────────────────────────────────────────────────
  // Publish Failure Tests
  // ───────────────────────────────────────────────────────────────

  t.test('Socket Publish Failures', async st => {
    st.test('publish fails with invalid event', async t => {
      const socket = new NostrSocket(url)
      await socket.connect()

      const event = create_test_event()
      const tampered = { ...event, sig: 'invalid' }

      try {
        await socket.publish(tampered)
        t.fail('should have rejected invalid event')
      } catch (err: any) {
        t.ok(err.ok === false || err.message, 'invalid event rejected')
      }

      socket.close()
      await wait_ms(100)
      t.end()
    })

    st.test('publish fails after close', async t => {
      const socket = new NostrSocket(url)
      await socket.connect()
      socket.close()
      await wait_ms(100)

      const event = create_test_event()

      try {
        await socket.publish(event)
        t.fail('should have failed after close')
      } catch (err: any) {
        t.ok(err.message || err, 'publish after close rejected')
      }
      t.end()
    })

    st.end()
  })

  // ───────────────────────────────────────────────────────────────
  // Query Failure Tests
  // ───────────────────────────────────────────────────────────────

  t.test('Socket Query Failures', async st => {
    st.test('query fails after close', async t => {
      const socket = new NostrSocket(url)
      await socket.connect()
      socket.close()
      await wait_ms(100)

      try {
        await socket.query({ kinds: [1] })
        t.fail('should have failed after close')
      } catch (err: any) {
        t.ok(err.message || err, 'query after close rejected')
      }
      t.end()
    })

    st.test('handles query with very short timeout', async t => {
      const socket = new NostrSocket(url, { msg_timeout: 2000 })
      await socket.connect()

      // Query should either succeed quickly or timeout
      try {
        const results = await socket.query({ kinds: [1] }, { duration: 10 })
        t.ok(Array.isArray(results), 'quick query succeeded')
      } catch (err: any) {
        t.ok(err.message, 'query timeout handled')
      }

      socket.close()
      await wait_ms(100)
      t.end()
    })

    st.end()
  })

  // ───────────────────────────────────────────────────────────────
  // Subscription Failure Tests
  // ───────────────────────────────────────────────────────────────

  t.test('Socket Subscription Failures', async st => {
    st.test('subscription fails after close', async t => {
      const socket = new NostrSocket(url)
      await socket.connect()
      socket.close()
      await wait_ms(100)

      const sub = socket.subscribe({ kinds: [1] })

      try {
        await sub.activate()
        t.fail('should have failed after close')
      } catch (err: any) {
        t.ok(err.message || err, 'subscribe after close rejected')
      }
      t.end()
    })

    st.test('cancel on inactive subscription is safe', async t => {
      const socket = new NostrSocket(url)
      await socket.connect()

      const sub = socket.subscribe({ kinds: [1] })
      // Cancel without activating
      sub.cancel()

      t.notOk(sub.is_active, 'subscription inactive')

      socket.close()
      await wait_ms(100)
      t.end()
    })

    st.test('double cancel is safe', async t => {
      const socket = new NostrSocket(url)
      await socket.connect()

      const sub = socket.subscribe({ kinds: [1] })
      await sub.activate()

      sub.cancel()
      sub.cancel() // Second cancel should be safe

      t.notOk(sub.is_active, 'subscription cancelled')

      socket.close()
      await wait_ms(100)
      t.end()
    })

    st.end()
  })

  // ───────────────────────────────────────────────────────────────
  // Disconnection Tests
  // ───────────────────────────────────────────────────────────────

  t.test('Socket Disconnection', async st => {
    st.test('handles relay shutdown gracefully', async t => {
      const tempRelay = new NostrRelay()
      await tempRelay.start({ port: TEST_PORTS.SOCKET.FAILURE + 10 })

      const socket = new NostrSocket(`ws://localhost:${TEST_PORTS.SOCKET.FAILURE + 10}`)
      await socket.connect()
      t.ok(socket.is_ready, 'connected to temp relay')

      // Stop relay while socket is connected
      tempRelay.stop()
      await wait_ms(500)

      t.notOk(socket.is_ready, 'socket detected relay shutdown')

      socket.close()
      t.end()
    })

    st.test('emits close event on disconnect', async t => {
      const tempRelay = new NostrRelay()
      await tempRelay.start({ port: TEST_PORTS.SOCKET.FAILURE + 11 })

      const socket = new NostrSocket(`ws://localhost:${TEST_PORTS.SOCKET.FAILURE + 11}`)
      let closeEmitted = false

      socket.on('closed', () => { closeEmitted = true })
      await socket.connect()

      tempRelay.stop()
      await wait_ms(500)

      t.ok(closeEmitted, 'close event emitted')

      socket.close()
      t.end()
    })

    st.end()
  })

  t.teardown(() => {
    relay.stop()
  })
}
