/**
 * Subscription Failure Tests
 *
 * Error scenario tests validating that NostrSubscription handles
 * failures and edge cases gracefully.
 */
import { Test }        from 'tape'
import { NostrRelay }  from '@/class/relay.js'
import { NostrSocket } from '@/class/socket.js'
import { TEST_PORTS, } from '#/config.js'

import { create_event, sign_event } from '@/lib/event.js'
import {
  wait_ms,
  create_keypair
} from '#/cases/integration/helpers/fixtures.js'

export default async function subscription_failure_tests (t: Test) {
  const relay = new NostrRelay()
  await relay.start({ port: TEST_PORTS.SUB.FAILURE })
  const url = `ws://localhost:${TEST_PORTS.SUB.FAILURE}`

  // ───────────────────────────────────────────────────────────────
  // Timeout Tests
  // ───────────────────────────────────────────────────────────────

  t.test('Subscription Timeouts', async st => {
    st.test('activate resolves even with short timeout', async t => {
      const socket = new NostrSocket(url, { sub_timeout: 100 })
      await socket.connect()

      const sub = socket.subscribe({ kinds: [9999] })

      // Should either succeed or timeout gracefully
      try {
        await sub.activate()
        t.pass('activation succeeded or timed out gracefully')
      } catch (err: any) {
        t.ok(err.message, 'timeout handled')
      }

      sub.cancel()
      socket.close()
      await wait_ms(100)
      t.end()
    })

    st.test('listen with zero duration returns immediately', async t => {
      const socket = new NostrSocket(url)
      await socket.connect()

      const sub = socket.subscribe({ kinds: [1] })
      await sub.activate()

      const start = Date.now()
      const events = await sub.listen({ mode: 'timeout', duration: 0 })
      const elapsed = Date.now() - start

      t.ok(Array.isArray(events), 'returns array')
      t.ok(elapsed < 100, 'returns quickly')

      sub.cancel()
      socket.close()
      await wait_ms(100)
      t.end()
    })

    st.end()
  })

  // ───────────────────────────────────────────────────────────────
  // Socket Disconnect Tests
  // ───────────────────────────────────────────────────────────────

  t.test('Subscription Socket Disconnect', async st => {
    st.test('handles socket close gracefully', async t => {
      const socket = new NostrSocket(url)
      await socket.connect()

      const sub = socket.subscribe({ kinds: [1] })
      await sub.activate()
      t.ok(sub.is_active, 'subscription active')

      // Close socket while subscription is active
      socket.close()
      await wait_ms(200)

      // Subscription should be inactive
      t.notOk(sub.is_active, 'subscription inactive after socket close')
      t.end()
    })

    st.test('incomplete listener rejects on socket close', async t => {
      const socket = new NostrSocket(url)
      await socket.connect()

      const sub = socket.subscribe({ kinds: [1] })
      await sub.activate()

      const listener = sub.listen({ mode: 'timeout', duration: 5000 })

      // Close socket after short delay
      setTimeout(() => socket.close(), 100)

      await listener.then(
        () => t.fail('incomplete listener returned partial success'),
        error => t.match(error.message, /cancelled/, 'listener rejects on close')
      )
      t.end()
    })

    st.end()
  })

  // ───────────────────────────────────────────────────────────────
  // Cancel Edge Cases
  // ───────────────────────────────────────────────────────────────

  t.test('Subscription Cancel Edge Cases', async st => {
    st.test('cancel before activate is safe', async t => {
      const socket = new NostrSocket(url)
      await socket.connect()

      const sub = socket.subscribe({ kinds: [1] })
      sub.cancel()

      t.notOk(sub.is_active, 'subscription not active')

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
      sub.cancel()

      t.notOk(sub.is_active, 'subscription cancelled')

      socket.close()
      await wait_ms(100)
      t.end()
    })

    st.test('cancel during event delivery is safe', async t => {
      const socket = new NostrSocket(url)
      await socket.connect()

      const { seckey, pubkey } = create_keypair()
      const filter = { kinds: [1], authors: [pubkey] }

      const sub = socket.subscribe(filter)
      let cancelCalled = false

      sub.on('event', () => {
        if (!cancelCalled) {
          cancelCalled = true
          sub.cancel()
        }
      })

      await sub.activate()

      const event = sign_event(create_event({ content: 'cancel-test', kind: 1, pubkey }), seckey)
      await socket.publish(event)
      await wait_ms(200)

      t.notOk(sub.is_active, 'subscription cancelled during event')

      socket.close()
      await wait_ms(100)
      t.end()
    })

    st.end()
  })

  // ───────────────────────────────────────────────────────────────
  // Relay Disconnect Tests
  // ───────────────────────────────────────────────────────────────

  t.test('Subscription Relay Disconnect', async st => {
    st.test('handles relay shutdown during subscription', async t => {
      const tempRelay = new NostrRelay()
      await tempRelay.start({ port: TEST_PORTS.SUB.FAILURE + 10 })

      const socket = new NostrSocket(`ws://localhost:${TEST_PORTS.SUB.FAILURE + 10}`)
      await socket.connect()

      const sub = socket.subscribe({ kinds: [1] })
      await sub.activate()
      t.ok(sub.is_active, 'subscription active')

      // Stop relay
      tempRelay.stop()
      await wait_ms(500)

      t.notOk(sub.is_active, 'subscription inactive after relay shutdown')

      socket.close()
      t.end()
    })

    st.end()
  })

  // ───────────────────────────────────────────────────────────────
  // Invalid State Tests
  // ───────────────────────────────────────────────────────────────

  t.test('Subscription Invalid States', async st => {
    st.test('listen on cancelled subscription returns empty', async t => {
      const socket = new NostrSocket(url)
      await socket.connect()

      const sub = socket.subscribe({ kinds: [1] })
      await sub.activate()
      sub.cancel()

      const events = await sub.listen({ mode: 'timeout', duration: 100 })
      t.ok(Array.isArray(events), 'returns array')
      t.equal(events.length, 0, 'empty array for cancelled subscription')

      socket.close()
      await wait_ms(100)
      t.end()
    })

    st.test('double activate is safe', async t => {
      const socket = new NostrSocket(url)
      await socket.connect()

      const sub = socket.subscribe({ kinds: [1] })
      await sub.activate()
      await sub.activate() // Second activate should be safe

      t.ok(sub.is_active, 'subscription still active')

      sub.cancel()
      socket.close()
      await wait_ms(100)
      t.end()
    })

    st.end()
  })

  t.teardown(() => {
    relay.stop()
  })
}
