import type { Test } from 'tape'
import { NostrSocket } from '@/class/socket.js'
import { MessageQueue } from '@/class/queue.js'
import { create_event, sign_event } from '@/lib/event.js'
import { get_pubkey } from '@/crypto/ecc.js'
import { MockWebSocket } from '#/helpers/mock-socket.js'
import type { EventFilter, SignedEvent } from '@/types/index.js'

const key = '01'.repeat(32)
const pubkey = get_pubkey(key)

function signed (kind = 1, tags: string[][] = [], created_at = 100, signer = key) {
  return sign_event(create_event({ kind, tags, created_at, pubkey: get_pubkey(signer), content: 'test' }), signer)
}

async function query (events: SignedEvent[], filters: EventFilter | EventFilter[]) {
  const wire = new MockWebSocket('wss://test.relay')
  const socket = new NostrSocket(wire as unknown as WebSocket)
  const raw: SignedEvent[] = []
  const rejects: unknown[] = []
  const controls: string[] = []
  socket.on('message', msg => {
    if (msg[0] === 'EVENT') raw.push(msg[2])
    else controls.push(msg[0])
  })
  socket.on('reject', msg => { rejects.push(msg) })
  wire.send = data => {
    const msg = JSON.parse(data)
    if (msg[0] !== 'REQ') return
    queueMicrotask(() => {
      for (const event of events) wire.simulateMessage(['EVENT', msg[1], event])
      wire.simulateMessage(['NOTICE', 'notice'])
      wire.simulateMessage(['OK', signed().id, true, 'stored'])
      wire.simulateMessage(['EOSE', msg[1]])
    })
  }
  wire.simulateOpen()
  try {
    return { events: await socket.query(filters, { duration: 100 }), raw, rejects, controls }
  } finally { socket.close() }
}

export default function runtime_tests (t: Test) {
  for (const nodeTimers of [false, true]) {
    t.test(nodeTimers ? 'Node timer handles retain unref' : 'browser numeric timers send and close', st => {
      const originals = { setTimeout, clearTimeout, setImmediate }
      const pending = new Map<unknown, () => void>()
      let serial = 0
      let unrefs = 0
      globalThis.setTimeout = ((callback: () => void) => {
        const id = nodeTimers ? { unref: () => { unrefs++ } } : ++serial
        pending.set(id, callback)
        return id
      }) as unknown as typeof setTimeout
      globalThis.clearTimeout = ((id: unknown) => { pending.delete(id) }) as typeof clearTimeout
      globalThis.setImmediate = undefined as unknown as typeof setImmediate
      const tick = () => {
        const [id, callback] = pending.entries().next().value!
        pending.delete(id)
        callback()
      }
      try {
        const sent: unknown[] = []
        const queue = new MessageQueue({
          config: { queue_ival: 10, queue_limit: 1 },
          ws: { readyState: WebSocket.OPEN },
          _send: (msg: unknown) => { sent.push(msg) }
        } as unknown as NostrSocket)
        queue.push(['CLOSE', 'first'])
        queue.push(['CLOSE', 'second'])
        st.doesNotThrow(tick, 'first batch schedules its follow-up without throwing')
        st.equal(sent.length, 1, 'sends only one batch at a time')
        st.doesNotThrow(tick, 'follow-up sends the remaining message')
        st.equal(sent.length, 2, 'both messages sent')
        queue.clear()

        const wire = new MockWebSocket('wss://test.relay')
        let closed = false
        wire.close = () => { closed = true }
        const socket = new NostrSocket(wire as unknown as WebSocket)
        wire.simulateOpen()
        st.doesNotThrow(() => socket.close(), 'close schedules without throwing')
        st.notOk(closed, 'close remains delayed')
        tick()
        st.ok(closed, 'scheduled close callback still executes')
        st.equal(unrefs, nodeTimers ? 2 : 0, 'unref only used on supported handles')
      } finally { Object.assign(globalThis, originals) }
      st.end()
    })
  }

  for (const kind of [10000, 30000, 1000]) {
    t.test(`query kind ${kind} rejects invalid signatures and relay filter violations`, async st => {
      const good = signed(kind, [['h', 'target']])
      const bad = { ...good, sig: '00'.repeat(64) }
      const result = await query([
        bad, { ...good, content: 'changed' },
        signed(kind, good.tags, 100, '02'.repeat(32)),
        signed(kind + 1, good.tags),
        signed(kind, [['h', 'wrong', 'target']]),
        signed(kind, good.tags, 99), good
      ], { authors: [pubkey], kinds: [kind], '#h': ['target'], since: 100 })
      st.deepEqual(result.events, [good], 'only the authentic matching event reaches query results')
      st.notOk(result.raw.some(event => event.sig === bad.sig || event.content === 'changed'), 'raw message listeners cannot consume rejected events')
      st.equal(result.rejects.length, 2, 'invalid signatures still emit rejection')
      st.deepEqual(result.controls, ['NOTICE', 'OK', 'EOSE'], 'control messages still finish the query')
      st.end()
    })
  }

  t.test('query filters preserve wildcard, inclusive times, zero bounds, IDs and OR', async st => {
    const events = [signed(1, [], 0), signed(1, [], 100), signed(1, [], 101)]
    st.deepEqual((await query(events, {})).events, events, 'wildcard accepts valid events')
    st.deepEqual((await query(events, { since: 100, until: 100 })).events, [events[1]], 'time-only bounds are inclusive')
    st.deepEqual((await query(events, { until: 0 })).events, [events[0]], 'zero is a real time bound')
    st.deepEqual((await query(events, [{ ids: [events[0].id] }, { ids: [events[2].id] }])).events, [events[0], events[2]], 'IDs match and alternatives are ORed')
    st.end()
  })

  t.test('persistent subscriptions reject invalid and unrelated messages before counting', st => {
    const wire = new MockWebSocket('wss://test.relay')
    const socket = new NostrSocket(wire as unknown as WebSocket)
    wire.simulateOpen()
    const sub = socket.subscribe({ authors: [pubkey], kinds: [1] })
    const received: SignedEvent[] = []
    sub.on('event', event => { received.push(event) })
    const good = signed()
    try {
      wire.simulateMessage(['EOSE', sub.sub_id])
      wire.simulateMessage(['EVENT', sub.sub_id, { ...good, sig: '00'.repeat(64) }])
      wire.simulateMessage(['EVENT', sub.sub_id, signed(2)])
      wire.simulateMessage(['EVENT', 'another-subscription', good])
      st.equal(sub.state.count, 0, 'discarded events do not change the subscription count')
      wire.simulateMessage(['EVENT', sub.sub_id, good])
      st.deepEqual(received, [good], 'only the matching signed event reaches the live subscriber')
      st.equal(sub.state.count, 1, 'counts accepted events')
    } finally { socket.close() }
    st.end()
  })

}
