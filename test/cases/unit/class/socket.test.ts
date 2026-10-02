import { Test } from 'tape'

import { NostrSocket } from '@/class/socket.js'

import { MockWebSocket }  from '#/helpers/mock-socket.js'
import { createTestEvent } from '#/helpers/index.js'

export default function socket_tests (t: Test) {
  t.test('NostrSocket', st => {

    st.test('constructor - accepts string URL', t => {
      // NostrSocket requires valid ws:// or wss:// URL
      t.throws(
        () => new NostrSocket('http://invalid.url'),
        /invalid WebSocket URL/,
        'rejects non-WebSocket URL'
      )
      t.throws(
        () => new NostrSocket(''),
        /invalid WebSocket URL/,
        'rejects empty string'
      )
      t.end()
    })

    st.test('constructor - accepts WebSocket instance', t => {
      const mock   = new MockWebSocket('wss://test.relay')
      const socket = new NostrSocket(mock as unknown as WebSocket)

      t.equal(socket.url, 'wss://test.relay', 'url extracted from mock socket')
      t.notOk(socket.is_ready, 'not ready before open')

      socket.close()
      t.end()
    })

    st.test('ready state - tracks WebSocket open/close', t => {
      const mock   = new MockWebSocket('wss://test.relay')
      const socket = new NostrSocket(mock as unknown as WebSocket)

      t.notOk(socket.is_ready, 'initially not ready')

      mock.simulateOpen()
      t.ok(socket.is_ready, 'ready after open')

      mock.simulateClose()
      t.notOk(socket.is_ready, 'not ready after close')

      t.end()
    })

    st.test('emits ready event on WebSocket open', async t => {
      const mock   = new MockWebSocket('wss://test.relay')
      const socket = new NostrSocket(mock as unknown as WebSocket)
      let readyEmitted = false

      socket.on('ready', () => { readyEmitted = true })
      mock.simulateOpen()

      t.ok(readyEmitted, 'ready event emitted')
      socket.close()
      t.end()
    })

    st.test('emits closed event on WebSocket close', async t => {
      const mock   = new MockWebSocket('wss://test.relay')
      const socket = new NostrSocket(mock as unknown as WebSocket)
      let closedEmitted = false

      socket.on('closed', () => { closedEmitted = true })
      mock.simulateOpen()
      mock.simulateClose()

      t.ok(closedEmitted, 'closed event emitted')
      t.end()
    })

    st.test('send - queues message for sending', t => {
      const mock   = new MockWebSocket('wss://test.relay')
      const socket = new NostrSocket(mock as unknown as WebSocket)
      mock.simulateOpen()

      const event = createTestEvent()
      socket.send([ 'EVENT', event ])

      // Message queue has short interval, wait for it
      setTimeout(() => {
        const sent = mock.getLastMessageParsed<unknown[]>()
        t.ok(sent, 'message was sent')
        t.equal(sent?.[0], 'EVENT', 'message type is EVENT')
        socket.close()
        t.end()
      }, 600)
    })

    st.test('publish - sends EVENT and awaits OK', async t => {
      const mock   = new MockWebSocket('wss://test.relay')
      const socket = new NostrSocket(mock as unknown as WebSocket)
      mock.simulateOpen()

      const event = createTestEvent()
      const publishPromise = socket.publish(event)

      // Wait for message queue to process
      await new Promise(r => setTimeout(r, 600))

      // Verify EVENT message sent
      const sent = mock.getLastMessageParsed<unknown[]>()
      t.equal(sent?.[0], 'EVENT', 'EVENT message sent')
      t.equal((sent?.[1] as any)?.id, event.id, 'correct event ID')

      // Simulate relay OK response
      mock.simulateMessage([ 'OK', event.id, true, '' ])

      const result = await publishPromise
      t.ok(result.ok, 'publish succeeded')
      t.equal(result.event_id, event.id, 'result has correct event_id')

      socket.close()
      t.end()
    })

    st.test('publish - rejects on relay rejection', async t => {
      const mock   = new MockWebSocket('wss://test.relay')
      const socket = new NostrSocket(mock as unknown as WebSocket)
      mock.simulateOpen()

      const event = createTestEvent()
      const publishPromise = socket.publish(event)

      // Wait for message queue to process
      await new Promise(r => setTimeout(r, 600))

      // Simulate relay rejection
      mock.simulateMessage([ 'OK', event.id, false, 'blocked: rate limited' ])

      try {
        await publishPromise
        t.fail('should have rejected')
      } catch (err: any) {
        t.notOk(err.ok, 'rejection has ok: false')
        t.equal(err.reason, 'blocked: rate limited', 'reason preserved')
      }

      socket.close()
      t.end()
    })

    st.test('message parsing - emits event for valid EVENT message', t => {
      const mock   = new MockWebSocket('wss://test.relay')
      const socket = new NostrSocket(mock as unknown as WebSocket)
      mock.simulateOpen()

      const testEvent = createTestEvent()
      let receivedEvent: any = null

      socket.on('event', (msg) => {
        receivedEvent = msg
      })

      socket.send([ 'REQ', 'sub123', {} ])
      mock.simulateMessage([ 'EVENT', 'sub123', testEvent ])

      t.ok(receivedEvent, 'event emitted')
      t.equal(receivedEvent[0], 'EVENT', 'message type is EVENT')
      t.equal(receivedEvent[2].id, testEvent.id, 'event ID matches')

      socket.close()
      t.end()
    })

    st.test('message parsing - emits notice for NOTICE message', t => {
      const mock   = new MockWebSocket('wss://test.relay')
      const socket = new NostrSocket(mock as unknown as WebSocket)
      mock.simulateOpen()

      let receivedNotice: string | null = null
      socket.on('notice', (msg) => { receivedNotice = msg })

      mock.simulateMessage([ 'NOTICE', 'server maintenance in 5 minutes' ])

      t.equal(receivedNotice, 'server maintenance in 5 minutes', 'notice text received')

      socket.close()
      t.end()
    })

    st.test('message parsing - emits receipt for OK message', t => {
      const mock   = new MockWebSocket('wss://test.relay')
      const socket = new NostrSocket(mock as unknown as WebSocket)
      mock.simulateOpen()

      let receivedReceipt: any = null
      socket.on('receipt', (msg) => { receivedReceipt = msg })

      // Use valid 64-char hex event ID (schema requires hex32)
      const eventId = 'a'.repeat(64)
      mock.simulateMessage([ 'OK', eventId, true, '' ])

      t.ok(receivedReceipt, 'receipt emitted')
      t.equal(receivedReceipt[1], eventId, 'event ID in receipt')
      t.equal(receivedReceipt[2], true, 'ok status in receipt')

      socket.close()
      t.end()
    })

    st.test('message parsing - emits reject for invalid message', t => {
      const mock   = new MockWebSocket('wss://test.relay')
      const socket = new NostrSocket(mock as unknown as WebSocket)
      mock.simulateOpen()

      let rejected = false
      socket.on('reject', () => { rejected = true })

      mock.simulateMessage([ 'INVALID', 'garbage' ])

      t.ok(rejected, 'reject event emitted for invalid message')

      socket.close()
      t.end()
    })

    st.test('connect - resolves immediately if already ready', async t => {
      const mock   = new MockWebSocket('wss://test.relay')
      const socket = new NostrSocket(mock as unknown as WebSocket)
      mock.simulateOpen()

      await socket.connect()
      t.pass('connect resolved immediately')

      socket.close()
      t.end()
    })

    st.test('connect - waits for ready event', async t => {
      const mock   = new MockWebSocket('wss://test.relay')
      const socket = new NostrSocket(mock as unknown as WebSocket)

      // Connect will wait for open
      const connectPromise = socket.connect()

      // Simulate delayed open
      setTimeout(() => mock.simulateOpen(), 50)

      await connectPromise
      t.ok(socket.is_ready, 'socket ready after connect resolves')

      socket.close()
      t.end()
    })

    st.end()
  })
}
