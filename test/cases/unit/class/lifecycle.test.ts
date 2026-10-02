import type { Test } from 'tape'
import { NostrClient } from '@/class/client.js'
import { NostrSocket } from '@/class/socket.js'
import { wait_for_ready } from '@/lib/index.js'
import { MessageQueue } from '@/class/queue.js'
import { create_event, sign_event } from '@/lib/event.js'
import { get_pubkey } from '@/crypto/ecc.js'
import { MockWebSocket } from '#/helpers/mock-socket.js'

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

export default function lifecycle_tests (t: Test) {
  t.test('remote close and late query cleanup leave no repeating queue timer', async st => {
    const wire = new MockWebSocket('wss://gone.relay')
    const socket = new NostrSocket(wire as unknown as WebSocket, { queue_ival: 10 })
    wire.simulateOpen()
    const pending = socket.query({}, { duration: 30 })
    await sleep(5)
    wire.simulateClose()
    st.equal(socket.subs.size, 0, 'temporary query is removed immediately on disconnect')
    await pending.then(() => st.fail('disconnected query returned a partial success'), error => st.match(error.message, /cancelled/, 'inflight query rejects after relay disappears'))
    const real = globalThis.setTimeout
    let armed = 0
    globalThis.setTimeout = ((fn: () => void, ms?: number) => {
      if (ms === 10) armed++
      return real(fn, ms)
    }) as typeof setTimeout
    try {
      await sleep(50)
      st.equal(armed, 0, 'late cancellation cannot rearm an undeliverable CLOSE')
      socket.close(0)
      await sleep(30)
      st.equal(armed, 0, 'explicit close also leaves no repeating queue')
    } finally { globalThis.setTimeout = real }
    st.end()
  })

  t.test('close aborts a connecting socket and rejects a late open', async st => {
    const wire = new MockWebSocket('wss://slow.relay')
    let closes = 0
    // Keep the native close event pending to exercise a racing open callback.
    wire.close = () => { closes++; wire.readyState = WebSocket.CLOSING }
    const socket = new NostrSocket(wire as unknown as WebSocket)
    let ready = 0
    socket.on('ready', () => { ready++ })
    socket.close(0)
    await sleep(5)
    st.equal(closes, 1, 'CONNECTING transport receives close')
    wire.simulateOpen()
    st.equal(closes, 2, 'late open is immediately closed again')
    st.notOk(socket.is_ready, 'explicitly closed socket never becomes ready')
    st.equal(ready, 0, 'no ready event escapes')
    wire.simulateClose()
    await socket.connect().then(() => st.fail('closed socket reconnected'), () => st.pass('closed socket cannot reconnect'))
    st.end()
  })

  t.test('queue clear invalidates an already deferred flush', st => {
    const original = globalThis.setImmediate
    const deferred: (() => void)[] = []
    globalThis.setImmediate = ((fn: () => void) => { deferred.push(fn); return {} }) as typeof setImmediate
    let sent = 0
    const queue = new MessageQueue({
      config: { queue_ival: 10, queue_limit: 1 },
      ws: { readyState: WebSocket.OPEN },
      _send: () => { sent++ }
    } as unknown as NostrSocket)
    try {
      queue.push(['CLOSE', 'old'])
      queue.clear()
      queue.push(['CLOSE', 'new'])
      deferred[0]()
      st.equal(sent, 0, 'obsolete deferred callback cannot consume replacement work')
      st.equal(queue.size, 1, 'replacement message remains queued')
      deferred[1]()
      st.equal(sent, 1, 'current generation sends replacement exactly once')
      st.equal(queue.size, 0, 'replacement batch drains')
    } finally {
      queue.clear()
      globalThis.setImmediate = original
    }
    st.end()
  })

  t.test('cheap subscription and filter rejection never bypasses verification for matching events', st => {
    const key = '01'.repeat(32)
    const pubkey = get_pubkey(key)
    const good = sign_event(create_event({ kind: 1, tags: [], created_at: 100, pubkey, content: 'test' }), key)
    const forged = { ...good, sig: '00'.repeat(64) }
    const wire = new MockWebSocket('wss://filtered.relay')
    const socket = new NostrSocket(wire as unknown as WebSocket)
    wire.simulateOpen()
    const sub = socket.subscribe({ kinds: [1], authors: [pubkey] })
    let rejected = 0
    let delivered = 0
    socket.on('reject', () => { rejected++ })
    socket.on('event', () => { delivered++ })
    for (let i = 0; i < 100; i++) {
      wire.simulateMessage(['EVENT', 'unknown', forged])
      wire.simulateMessage(['EVENT', sub.sub_id, { ...forged, kind: 2 }])
    }
    st.equal(rejected, 0, 'unsolicited and filter-mismatched signatures never reach verification rejection')
    st.equal(delivered, 0, 'discarded traffic is not emitted to consumers')
    wire.simulateMessage(['EVENT', sub.sub_id, forged])
    st.equal(rejected, 1, 'matching forged event still fails cryptographic verification')
    wire.simulateMessage(['EVENT', sub.sub_id, good])
    st.equal(delivered, 1, 'valid matching event is delivered')
    sub.cancel()
    wire.simulateMessage(['EVENT', sub.sub_id, forged])
    st.equal(rejected, 1, 'cancelled subscriptions are no longer verification targets')
    socket.close(0)
    st.end()
  })
  t.test('explicit close cancels keep-alive immediately, before delayed transport close', async st => {
    const wire = new MockWebSocket('wss://timer.relay')
    const socket = new NostrSocket(wire as unknown as WebSocket, { sub_timeout: 5 })
    wire.simulateOpen()
    const sub = socket.subscribe({})
    wire.simulateMessage(['EOSE', sub.sub_id])
    socket.close(40)
    await sleep(20)
    st.equal(socket.subs.size, 0, 'subscription removed before transport close')
    st.equal(wire.messages.length, 0, 'keep-alive did not enqueue after close')
    await sleep(30)
    st.end()
  })

  t.test('keep-alive tolerates transport closing before its close event', async st => {
    const wire = new MockWebSocket('wss://closing.relay')
    const socket = new NostrSocket(wire as unknown as WebSocket, { sub_timeout: 5 })
    wire.simulateOpen()
    const sub = socket.subscribe({})
    wire.simulateMessage(['EOSE', sub.sub_id])
    wire.readyState = WebSocket.CLOSING
    let errors = 0
    socket.on('error', () => { errors++ })
    await sleep(15)
    st.equal(errors, 1, 'timer reports transport loss without an uncaught exception')
    st.notOk(sub.is_active, 'subscription pauses until transport recovery')
    socket.close(0)
    wire.simulateClose()
    st.end()
  })

  t.test('persistent client subscription resumes on a new transport after remote drop', async st => {
    const OriginalWebSocket = globalThis.WebSocket
    const wires: MockWebSocket[] = []
    class ReconnectingSocket extends MockWebSocket {
      constructor (url: string) {
        super(url)
        wires.push(this)
        setTimeout(() => this.simulateOpen(), 0)
      }
      send (data: string) {
        super.send(data)
        const msg = JSON.parse(data)
        if (msg[0] === 'REQ') queueMicrotask(() => this.simulateMessage(['EOSE', msg[1]]))
      }
    }
    globalThis.WebSocket = ReconnectingSocket as unknown as typeof WebSocket
    const client = new NostrClient(['wss://resume.relay'], { queue_ival: 5, msg_timeout: 100 })
    try {
      await client.connect()
      const manager = await client.subscribe({ kinds: [1] }).activate()
      const delivered: string[] = []
      manager.on('event', event => { delivered.push(event.id) })
      const resumed = wait_for_ready(manager, { timeout: 2000, ready_event: 'active', error_event: undefined, timeout_msg: 'resume timeout', error_msg: () => '' })
      wires[0].simulateClose()
      st.notOk(manager.is_active, 'manager becomes inactive while disconnected')
      await resumed
      st.equal(wires.length, 2, 'a new transport is opened')
      st.ok(client.is_ready, 'client readiness recovers')
      st.ok(manager.is_active, 'existing manager resumes after EOSE')
      const good = sign_event(create_event({ kind: 1, pubkey: get_pubkey('01'.repeat(32)), content: 'resumed' }), '01'.repeat(32))
      const sub = manager.subs[0]
      wires[1].simulateMessage(['EVENT', sub.sub_id, good])
      st.deepEqual(delivered, [good.id], 'same consumer receives verified events after reconnect')
    } finally {
      client.close()
      await sleep(110)
      globalThis.WebSocket = OriginalWebSocket
    }
    st.end()
  })

  t.test('CLOSED removes managed and raw verification targets even before EOSE', st => {
    const wire = new MockWebSocket('wss://closed.relay')
    const socket = new NostrSocket(wire as unknown as WebSocket)
    wire.simulateOpen()
    const sub = socket.subscribe({ kinds: [1] })
    socket.send(['REQ', 'raw', { kinds: [1] }])
    wire.simulateMessage(['CLOSED', sub.sub_id, 'blocked'])
    wire.simulateMessage(['CLOSED', 'raw', 'blocked'])
    const good = sign_event(create_event({ kind: 1, pubkey: get_pubkey('01'.repeat(32)), content: '' }), '01'.repeat(32))
    let rejects = 0
    socket.on('reject', () => { rejects++ })
    wire.simulateMessage(['EVENT', sub.sub_id, { ...good, sig: '00'.repeat(64) }])
    wire.simulateMessage(['EVENT', 'raw', { ...good, sig: '00'.repeat(64) }])
    st.equal(socket.subs.size, 0, 'closed subscription removed')
    st.equal(rejects, 0, 'closed traffic never reaches signature verification')
    socket.close(0)
    st.end()
  })

  t.test('verification yields bounded batches and EOSE stays behind all preceding events', async st => {
    const wire = new MockWebSocket('wss://bounded.relay')
    const socket = new NostrSocket(wire as unknown as WebSocket, { verify_batch: 2, receive_limit: 32 })
    wire.simulateOpen()
    const sub = socket.subscribe({ kinds: [1] })
    const good = sign_event(create_event({ kind: 1, pubkey: get_pubkey('01'.repeat(32)), content: '' }), '01'.repeat(32))
    const order: string[] = []
    let rejects = 0
    socket.on('reject', () => { rejects++ })
    sub.on('event', () => { order.push('event') })
    sub.on('eose', () => { order.push('eose') })
    const drained = wait_for_ready(sub, { timeout: 2000, ready_event: 'eose', error_event: 'cancel', timeout_msg: 'drain timeout', error_msg: String })
    for (let i = 0; i < 7; i++) wire.simulateMessage(['EVENT', sub.sub_id, { ...good, sig: '00'.repeat(64) }])
    wire.simulateMessage(['EVENT', sub.sub_id, good])
    wire.simulateMessage(['EOSE', sub.sub_id])
    st.equal(rejects, 2, 'only configured verification batch runs synchronously')
    st.deepEqual(order, [], 'EOSE cannot overtake the queued event')
    await drained
    st.equal(rejects, 7, 'queued invalid signatures are still verified and rejected')
    st.deepEqual(order, ['event', 'eose'], 'delivery preserves relay order after yielding')
    socket.close(0)
    st.end()
  })

  t.test('verification backlog overflow closes instead of accumulating unbounded work', async st => {
    const wire = new MockWebSocket('wss://flood.relay')
    const socket = new NostrSocket(wire as unknown as WebSocket, { verify_batch: 1, receive_limit: 3 })
    wire.simulateOpen()
    const sub = socket.subscribe({ kinds: [1] })
    const good = sign_event(create_event({ kind: 1, pubkey: get_pubkey('01'.repeat(32)), content: '' }), '01'.repeat(32))
    let rejects = 0
    let error = ''
    socket.on('reject', () => { rejects++ })
    socket.on('error', message => { error = message })
    for (let i = 0; i < 100; i++) wire.simulateMessage(['EVENT', sub.sub_id, { ...good, sig: '00'.repeat(64) }])
    await sleep(10)
    st.equal(rejects, 1, 'queued work is discarded on overflow')
    st.equal(wire.readyState, WebSocket.CLOSED, 'overloaded relay is disconnected')
    st.ok(error.includes('backlog'), 'overload is reported')
    st.end()
  })

  t.test('overflow rejects an incomplete query and leaves the socket reconnectable', async st => {
    const original = globalThis.WebSocket
    const wires: MockWebSocket[] = []
    class ReconnectingSocket extends MockWebSocket {
      constructor (url: string) { super(url); wires.push(this); queueMicrotask(() => this.simulateOpen()) }
    }
    globalThis.WebSocket = ReconnectingSocket as unknown as typeof WebSocket
    const socket = new NostrSocket('wss://overflow.relay', { verify_batch: 1, receive_limit: 2, queue_ival: 1 })
    try {
      await socket.connect()
      const result = socket.query({ kinds: [1] }).then(() => 'resolved', error => error.message)
      await Promise.resolve()
      const sub = [...socket.subs.values()][0]
      const good = sign_event(create_event({ kind: 1, pubkey: get_pubkey('01'.repeat(32)), content: 'partial' }), '01'.repeat(32))
      for (let i = 0; i < 5; i++) wires[0].simulateMessage(['EVENT', sub.sub_id, good])
      st.match(await result, /backlog/, 'buffered partial result rejects on overflow')
      if (wires[0].readyState !== WebSocket.CLOSED) await new Promise<void>(resolve => wires[0].addEventListener('close', () => resolve()))
      await socket.connect()
      st.equal(wires.length, 2, 'caller can reconnect after receive overload')
      st.ok(socket.is_ready, 'new transport is usable')
    } finally { socket.close(0); await sleep(5); globalThis.WebSocket = original }
    st.end()
  })

  t.test('subscription created before a drop can activate after reconnect', async st => {
    const original = globalThis.WebSocket
    const wires: MockWebSocket[] = []
    class ReconnectingSocket extends MockWebSocket {
      constructor (url: string) { super(url); wires.push(this); queueMicrotask(() => this.simulateOpen()) }
      send (data: string) {
        super.send(data)
        const msg = JSON.parse(data)
        if (msg[0] === 'REQ') queueMicrotask(() => this.simulateMessage(['EOSE', msg[1]]))
      }
    }
    globalThis.WebSocket = ReconnectingSocket as unknown as typeof WebSocket
    const socket = new NostrSocket('wss://unstarted.relay', { queue_ival: 1, msg_timeout: 1000 })
    try {
      await socket.connect()
      const sub = socket.subscribe({ kinds: [1] })
      wires[0].simulateClose()
      await socket.connect()
      await sub.activate()
      st.ok(sub.is_active, 'first REQ after reconnect reaches EOSE')
      st.ok(wires[1].messages.some(raw => JSON.parse(raw)[0] === 'REQ'), 'new transport receives the previously unstarted request')
    } finally { socket.close(0); await sleep(5); globalThis.WebSocket = original }
    st.end()
  })

  t.test('historical filter limits are independent and do not suppress live events', st => {
    const wire = new MockWebSocket('wss://limits.relay')
    const socket = new NostrSocket(wire as unknown as WebSocket, { verify_batch: 20 })
    wire.simulateOpen()
    const sub = socket.subscribe([{ kinds: [1], limit: 1 }, { kinds: [2], limit: 2 }])
    const received: number[] = []
    let rejected = 0
    sub.on('event', event => { received.push(event.kind) })
    socket.on('reject', () => { rejected++ })
    const make = (kind: number) => sign_event(create_event({ kind, pubkey: get_pubkey('01'.repeat(32)), content: '' }), '01'.repeat(32))
    const one = make(1), two = make(2)
    wire.simulateMessage(['EVENT', sub.sub_id, { ...one, sig: '00'.repeat(64) }])
    wire.simulateMessage(['EVENT', sub.sub_id, one])
    wire.simulateMessage(['EVENT', sub.sub_id, one])
    wire.simulateMessage(['EVENT', sub.sub_id, two])
    wire.simulateMessage(['EVENT', sub.sub_id, two])
    wire.simulateMessage(['EVENT', sub.sub_id, two])
    st.deepEqual(received, [1, 2, 2], 'each OR filter bounds valid historical delivery')
    st.equal(rejected, 1, 'invalid signatures do not spend a historical allowance')
    wire.simulateMessage(['EOSE', sub.sub_id])
    wire.simulateMessage(['EVENT', sub.sub_id, one])
    st.deepEqual(received, [1, 2, 2, 1], 'live events after EOSE remain deliverable')
    socket.close(0)
    st.end()
  })

  t.test('cancelled subscriptions can reactivate and explicit close blocks new requests immediately', async st => {
    const wire = new MockWebSocket('wss://reactivate.relay')
    const socket = new NostrSocket(wire as unknown as WebSocket, { queue_ival: 1, msg_timeout: 1000 })
    wire.simulateOpen()
    const sub = socket.subscribe({})
    sub.cancel()
    const active = sub.activate()
    wire.simulateMessage(['EOSE', sub.sub_id])
    await active
    st.ok(sub.is_active, 'cancelled listener is reattached for reactivation')
    st.equal(socket.subs.get(sub.sub_id), sub, 'reactivated subscription participates in socket lifecycle')
    socket.close(100)
    st.throws(() => socket.send(['REQ', 'late', {}]), /closed/, 'REQ is rejected before the delayed transport close')
    wire.simulateClose()
    st.end()
  })

  t.test('successful reconnect resets retries and old transport callbacks cannot affect the replacement', async st => {
    const original = globalThis.WebSocket
    const wires: MockWebSocket[] = []
    class ReconnectingSocket extends MockWebSocket {
      constructor (url: string) { super(url); wires.push(this); queueMicrotask(() => this.simulateOpen()) }
      send (data: string) {
        super.send(data)
        const msg = JSON.parse(data)
        if (msg[0] === 'REQ') queueMicrotask(() => this.simulateMessage(['EOSE', msg[1]]))
      }
    }
    globalThis.WebSocket = ReconnectingSocket as unknown as typeof WebSocket
    const socket = new NostrSocket('wss://retry.relay', { queue_ival: 1, msg_timeout: 1000, max_retries: 2 })
    try {
      await socket.connect()
      const sub = await socket.subscribe({}).activate()
      for (let n = 0; n < 4; n++) {
        const active = wait_for_ready(sub, { timeout: 2000, ready_event: 'active', error_event: undefined, timeout_msg: 'reconnect exhausted', error_msg: String })
        wires.at(-1)!.simulateClose()
        await active
      }
      st.equal(wires.length, 5, 'successful sessions restore the retry budget across four separate drops')
      const old = wires.at(-1)!
      old.readyState = WebSocket.CLOSING
      await socket.connect()
      old.simulateClose()
      st.ok(socket.is_ready, 'late close from a replaced transport cannot close its successor')
    } finally { socket.close(0); await sleep(5); globalThis.WebSocket = original }
    st.end()
  })

  t.test('failed reconnects stop at max_retries', async st => {
    const original = globalThis.WebSocket
    const realTimeout = globalThis.setTimeout
    const retries: (() => void)[] = []
    let attempts = 0
    class FailingSocket extends MockWebSocket {
      constructor (url: string) {
        super(url); attempts++
        queueMicrotask(() => { this.simulateError(new Error('offline')); this.simulateClose() })
      }
    }
    globalThis.WebSocket = FailingSocket as unknown as typeof WebSocket
    globalThis.setTimeout = ((fn: () => void, ms?: number) => {
      if (ms === 17) { retries.push(fn); return { unref () {} } }
      return realTimeout(fn, ms)
    }) as typeof setTimeout
    const wire = new MockWebSocket('wss://bounded-retry.relay')
    const socket = new NostrSocket(wire as unknown as WebSocket, { queue_ival: 17, msg_timeout: 1000, max_retries: 3 })
    try {
      wire.simulateOpen()
      socket.subscribe({}).listen().catch(() => {})
      wire.simulateClose()
      for (let n = 0; n < 6; n++) {
        retries.shift()?.()
        for (let tick = 0; tick < 5; tick++) await Promise.resolve()
      }
      st.equal(attempts, 3, 'only the configured replacement transports are attempted')
      st.equal(retries.length, 0, 'no further reconnect timer remains')
    } finally { socket.close(0); globalThis.setTimeout = realTimeout; globalThis.WebSocket = original }
    st.end()
  })

  t.test('repeated history overflow stops after the configured reconnect budget', async st => {
    const original = globalThis.WebSocket
    const wires: MockWebSocket[] = []
    const good = sign_event(create_event({ kind: 1, pubkey: get_pubkey('01'.repeat(32)), content: 'burst' }), '01'.repeat(32))
    class FloodingSocket extends MockWebSocket {
      constructor (url: string) { super(url); wires.push(this); queueMicrotask(() => this.simulateOpen()) }
      send (data: string) {
        super.send(data)
        const msg = JSON.parse(data)
        if (msg[0] === 'REQ') queueMicrotask(() => {
          for (let i = 0; i < 5; i++) this.simulateMessage(['EVENT', msg[1], good])
        })
      }
    }
    globalThis.WebSocket = FloodingSocket as unknown as typeof WebSocket
    const socket = new NostrSocket('wss://overflow-budget.relay', { verify_batch: 1, receive_limit: 2, queue_ival: 1, max_retries: 2 })
    try {
      await socket.connect()
      const sub = socket.subscribe({ kinds: [1] })
      const terminal = new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('overflow reconnect did not stop')), 2000)
        sub.on('cancel', () => { if (!socket.subs.has(sub.sub_id)) { clearTimeout(timer); resolve() } })
      })
      void sub.listen().catch(() => {})
      await terminal
      st.equal(wires.length, 3, 'initial transport plus exactly two overflow retries')
      st.equal(socket.subs.size, 0, 'exhausted subscription is terminal instead of silently paused')
    } finally { socket.close(0); await sleep(5); globalThis.WebSocket = original }
    st.end()
  })

  t.test('a throttled verification drain cannot turn query timeout into partial success', async st => {
    const realTimeout = globalThis.setTimeout
    const timers = new Map<number, (() => void)[]>()
    globalThis.setTimeout = ((fn: () => void, ms = 0) => {
      timers.set(ms, [...(timers.get(ms) ?? []), fn]); return { unref () {} }
    }) as typeof setTimeout
    const wire = new MockWebSocket('wss://hidden-tab.relay')
    const socket = new NostrSocket(wire as unknown as WebSocket, { verify_batch: 1, receive_limit: 10 })
    try {
      wire.simulateOpen()
      const result = socket.query({ kinds: [1] }, { duration: 300 }).then(() => 'success', error => error.message)
      await Promise.resolve()
      const sub = [...socket.subs.values()][0]
      const good = sign_event(create_event({ kind: 1, pubkey: get_pubkey('01'.repeat(32)), content: 'queued' }), '01'.repeat(32))
      wire.simulateMessage(['EVENT', sub.sub_id, good]); wire.simulateMessage(['EVENT', sub.sub_id, good]); wire.simulateMessage(['EOSE', sub.sub_id])
      timers.get(300)?.[0]()
      st.match(await result, /backlog at timeout/, 'received but unverified results reject at the deadline')
      st.equal(socket.subs.size, 0, 'timed-out query is cleaned up')
    } finally { socket.close(0); globalThis.setTimeout = realTimeout; wire.simulateClose() }
    st.end()
  })

  t.test('send before connect throws synchronously without arming an unsafe queue flush', st => {
    const socket = new NostrSocket('wss://not-connected.relay')
    st.throws(() => socket.send(['REQ', 'early', {}]), /connect before sending/, 'caller receives the error directly')
    socket.close(0)
    st.end()
  })

  t.test('a never-opened replacement detaches callbacks from the caller transport', async st => {
    const original = globalThis.WebSocket
    class Replacement extends MockWebSocket {
      constructor (url: string) { super(url); queueMicrotask(() => this.simulateOpen()) }
    }
    globalThis.WebSocket = Replacement as unknown as typeof WebSocket
    const old = new MockWebSocket('wss://never-opened.relay')
    const socket = new NostrSocket(old as unknown as WebSocket)
    try {
      old.readyState = WebSocket.CLOSING
      await socket.connect()
      old.simulateClose()
      st.ok(socket.is_ready, 'old connecting transport cannot close its replacement')
    } finally { socket.close(0); await sleep(5); globalThis.WebSocket = original }
    st.end()
  })

  t.test('unstarted subscriptions never schedule reconnect and cancellation stays terminal', async st => {
    const realTimeout = globalThis.setTimeout
    let scheduled = 0
    globalThis.setTimeout = ((fn: () => void, ms?: number) => {
      if (ms === 17) { scheduled++; return { unref () {} } }
      return realTimeout(fn, ms)
    }) as typeof setTimeout
    const wire = new MockWebSocket('wss://unused.relay')
    const socket = new NostrSocket(wire as unknown as WebSocket, { queue_ival: 17 })
    try {
      wire.simulateOpen()
      const sub = socket.subscribe({})
      wire.simulateClose()
      st.equal(scheduled, 0, 'an unused subscription does not dial another transport')
      let cancelled = 0; sub.on('cancel', () => { cancelled++ })
      sub.cancel(); sub.cancel()
      st.equal(cancelled, 1, 'cancel event is emitted once')
      let settled = false
      void sub.listen({ duration: 100 }).then(() => { settled = true })
      await Promise.resolve()
      st.ok(settled, 'an already cancelled listener settles without waiting for a timer')
    } finally { socket.close(0); globalThis.setTimeout = realTimeout }
    st.end()
  })

  t.test('exhausted historical filters are dropped before queueing without disrupting other requests', st => {
    const wire = new MockWebSocket('wss://limit-flood.relay')
    const socket = new NostrSocket(wire as unknown as WebSocket, { verify_batch: 2, receive_limit: 3 })
    wire.simulateOpen()
    const good = sign_event(create_event({ kind: 1, pubkey: get_pubkey('01'.repeat(32)), content: '' }), '01'.repeat(32))
    socket.send(['REQ', 'limited', { kinds: [1], limit: 1 }]); socket.send(['REQ', 'other', { kinds: [1] }])
    const received: string[] = []; socket.on('event', msg => { received.push(msg[1]) })
    wire.simulateMessage(['EVENT', 'limited', good])
    for (let n = 0; n < 20; n++) wire.simulateMessage(['EVENT', 'limited', good])
    wire.simulateMessage(['EVENT', 'other', good])
    st.deepEqual(received, ['limited', 'other'], 'over-limit flood does not fill the backlog or starve another query')
    socket.close(0); st.end()
  })

  t.test('queued events recheck allowances and a repeated REQ resets only its history', async st => {
    const wire = new MockWebSocket('wss://limit-cycle.relay')
    const socket = new NostrSocket(wire as unknown as WebSocket, { verify_batch: 1, receive_limit: 10 })
    wire.simulateOpen()
    const good = sign_event(create_event({ kind: 1, pubkey: get_pubkey('01'.repeat(32)), content: '' }), '01'.repeat(32))
    const sub = socket.subscribe({ kinds: [1], limit: 1 }); socket.send(['REQ', sub.sub_id, ...sub.filters])
    let count = 0; sub.on('event', () => { count++ })
    for (let cycle = 0; cycle < 2; cycle++) {
      if (cycle) socket.send(['REQ', sub.sub_id, ...sub.filters])
      const eose = wait_for_ready(sub, { timeout: 2000, ready_event: 'eose', error_event: 'cancel', timeout_msg: 'limit drain timeout', error_msg: String })
      wire.simulateMessage(['NOTICE', 'use this turn budget'])
      wire.simulateMessage(['EVENT', sub.sub_id, good]); wire.simulateMessage(['EVENT', sub.sub_id, good]); wire.simulateMessage(['EOSE', sub.sub_id])
      await eose
      st.equal(count, cycle + 1, 'each REQ delivers exactly one historical event even when multiple events were queued before verification')
    }
    socket.close(0); st.end()
  })

}
