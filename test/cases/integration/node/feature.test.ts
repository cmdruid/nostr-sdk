/**
 * Node Feature Tests
 *
 * Happy path tests validating that NostrNode P2P communication
 * works correctly under normal conditions.
 */
import { Test }       from 'tape'
import { NostrRelay } from '@/class/relay.js'
import { NostrNode }  from '@/class/node.js'
import { TEST_PORTS } from '#/config.js'

import { gen_seckey, get_pubkey } from '@/crypto/ecc.js'
import {
  wait_ms,
} from '#/cases/integration/helpers/fixtures.js'

import type { RpcMessageData, RequestRpcMessage } from '@/types/index.js'

function wait_for_message (node: NostrNode, topic: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { node.off('message', handler); reject(new Error(`missing ${topic} announcement`)) }, 5000)
    const handler = (message: RpcMessageData) => {
      if (message.type !== 'event' || message.topic !== topic) return
      clearTimeout(timer)
      node.off('message', handler)
      resolve()
    }
    node.on('message', handler)
  })
}

export default async function node_feature_tests (t: Test) {
  const relay1 = new NostrRelay()
  const relay2 = new NostrRelay()

  await relay1.start({ port: TEST_PORTS.NODE.RELAY_1 })
  await relay2.start({ port: TEST_PORTS.NODE.RELAY_2 })

  const urls = [
    `ws://localhost:${TEST_PORTS.NODE.RELAY_1}`,
    `ws://localhost:${TEST_PORTS.NODE.RELAY_2}`
  ]

  // ───────────────────────────────────────────────────────────────
  // Connection Tests
  // ───────────────────────────────────────────────────────────────

  t.test('Node Connection', async st => {
    st.test('connects and becomes ready', async t => {
      const seckey1 = gen_seckey()
      const seckey2 = gen_seckey()
      const pubkey1 = get_pubkey(seckey1)
      const pubkey2 = get_pubkey(seckey2)

      const node1 = new NostrNode([pubkey2], urls, seckey1)
      const node2 = new NostrNode([pubkey1], urls, seckey2)

      await Promise.all([node1.connect(), node2.connect()])

      t.ok(node1.is_ready, 'node1 ready')
      t.ok(node2.is_ready, 'node2 ready')

      node1.close()
      node2.close()
      await wait_ms(200)
      t.end()
    })

    st.test('emits ready event', async t => {
      const seckey1 = gen_seckey()
      const seckey2 = gen_seckey()
      const pubkey2 = get_pubkey(seckey2)

      const node1 = new NostrNode([pubkey2], urls, seckey1)
      let emitted = false

      node1.on('ready', () => { emitted = true })
      await node1.connect()

      t.ok(emitted, 'ready event emitted')

      node1.close()
      await wait_ms(200)
      t.end()
    })

    st.test('close disconnects', async t => {
      const seckey1 = gen_seckey()
      const seckey2 = gen_seckey()
      const pubkey2 = get_pubkey(seckey2)

      const node1 = new NostrNode([pubkey2], urls, seckey1)
      await node1.connect()
      t.ok(node1.is_ready, 'connected')

      node1.close()
      await wait_ms(200)

      t.notOk(node1.is_ready, 'disconnected')
      t.end()
    })

    st.end()
  })

  // ───────────────────────────────────────────────────────────────
  // Request/Response Tests
  // ───────────────────────────────────────────────────────────────

  t.test('Node Request/Response', async st => {
    st.test('sends request and receives response', async t => {
      const seckey1 = gen_seckey()
      const seckey2 = gen_seckey()
      const pubkey1 = get_pubkey(seckey1)
      const pubkey2 = get_pubkey(seckey2)

      const node1 = new NostrNode([pubkey2], urls, seckey1)
      const node2 = new NostrNode([pubkey1], urls, seckey2)

      await Promise.all([node1.connect(), node2.connect()])

      // Node2 listens for requests and responds
      node2.on('message', (msg: RpcMessageData) => {
        if (msg.type === 'request') {
          const req = msg as RpcMessageData & RequestRpcMessage
          node2.respond(req).accept({ result: 'hello' })
        }
      })

      // Node1 sends request to node2
      const response = await node1.request(
        { method: 'test', params: [] },
        pubkey2,
        { timeout: 5000 }
      )

      t.equal(response.type, 'accept', 'received accept response')
      t.deepEqual((response as any).data, { result: 'hello' }, 'response data correct')

      node1.close()
      node2.close()
      await wait_ms(200)
      t.end()
    })

    st.test('sends request and receives rejection', async t => {
      const seckey1 = gen_seckey()
      const seckey2 = gen_seckey()
      const pubkey1 = get_pubkey(seckey1)
      const pubkey2 = get_pubkey(seckey2)

      const node1 = new NostrNode([pubkey2], urls, seckey1)
      const node2 = new NostrNode([pubkey1], urls, seckey2)

      await Promise.all([node1.connect(), node2.connect()])

      // Node2 rejects all requests
      node2.on('message', (msg: RpcMessageData) => {
        if (msg.type === 'request') {
          const req = msg as RpcMessageData & RequestRpcMessage
          node2.respond(req).reject('not allowed')
        }
      })

      // Node1 sends request to node2
      const response = await node1.request(
        { method: 'test', params: [] },
        pubkey2,
        { timeout: 5000 }
      )

      t.equal(response.type, 'reject', 'received reject response')
      t.equal((response as any).reason, 'not allowed', 'rejection reason correct')

      node1.close()
      node2.close()
      await wait_ms(200)
      t.end()
    })

    st.end()
  })

  // ───────────────────────────────────────────────────────────────
  // Cast (Multi-Peer) Tests
  // ───────────────────────────────────────────────────────────────

  t.test('Node Cast', async st => {
    st.test('broadcasts to multiple peers and collects responses', async t => {
      const seckey1 = gen_seckey()
      const seckey2 = gen_seckey()
      const seckey3 = gen_seckey()
      const pubkey1 = get_pubkey(seckey1)
      const pubkey2 = get_pubkey(seckey2)
      const pubkey3 = get_pubkey(seckey3)

      const node1 = new NostrNode([pubkey2, pubkey3], urls, seckey1)
      const node2 = new NostrNode([pubkey1], urls, seckey2)
      const node3 = new NostrNode([pubkey1], urls, seckey3)

      await Promise.all([node1.connect(), node2.connect(), node3.connect()])

      // Both peers respond
      node2.on('message', (msg: RpcMessageData) => {
        if (msg.type === 'request') {
          const req = msg as RpcMessageData & RequestRpcMessage
          node2.respond(req).accept({ from: 'node2' })
        }
      })

      node3.on('message', (msg: RpcMessageData) => {
        if (msg.type === 'request') {
          const req = msg as RpcMessageData & RequestRpcMessage
          node3.respond(req).accept({ from: 'node3' })
        }
      })

      // Cast to both peers
      const responses = await node1.cast(
        { method: 'ping', params: [] },
        [pubkey2, pubkey3],
        { timeout: 5000 }
      )

      t.equal(responses.length, 2, 'received 2 responses')
      t.ok(responses.some(r => (r as any).data?.from === 'node2'), 'node2 responded')
      t.ok(responses.some(r => (r as any).data?.from === 'node3'), 'node3 responded')

      node1.close()
      node2.close()
      node3.close()
      await wait_ms(200)
      t.end()
    })

    st.test('cast with threshold returns early', async t => {
      const seckey1 = gen_seckey()
      const seckey2 = gen_seckey()
      const seckey3 = gen_seckey()
      const pubkey1 = get_pubkey(seckey1)
      const pubkey2 = get_pubkey(seckey2)
      const pubkey3 = get_pubkey(seckey3)

      const node1 = new NostrNode([pubkey2, pubkey3], urls, seckey1)
      const node2 = new NostrNode([pubkey1], urls, seckey2)
      const node3 = new NostrNode([pubkey1], urls, seckey3)

      await Promise.all([node1.connect(), node2.connect(), node3.connect()])

      // Only node2 responds quickly
      node2.on('message', (msg: RpcMessageData) => {
        if (msg.type === 'request') {
          const req = msg as RpcMessageData & RequestRpcMessage
          node2.respond(req).accept({ from: 'node2' })
        }
      })

      // node3 doesn't respond

      // Cast with threshold=1
      const responses = await node1.cast(
        { method: 'ping', params: [] },
        [pubkey2, pubkey3],
        { threshold: 1, timeout: 2000 }
      )

      t.ok(responses.length >= 1, `got ${responses.length} responses with threshold=1`)

      node1.close()
      node2.close()
      node3.close()
      await wait_ms(200)
      t.end()
    })

    st.end()
  })

  // ───────────────────────────────────────────────────────────────
  // Announce (Fire-and-Forget) Tests
  // ───────────────────────────────────────────────────────────────

  t.test('Node Announce', async st => {
    st.test('announces event to peer', async t => {
      const seckey1 = gen_seckey()
      const seckey2 = gen_seckey()
      const pubkey1 = get_pubkey(seckey1)
      const pubkey2 = get_pubkey(seckey2)

      const node1 = new NostrNode([pubkey2], urls, seckey1)
      const node2 = new NostrNode([pubkey1], urls, seckey2)

      await Promise.all([node1.connect(), node2.connect()])

      const received = wait_for_message(node2, 'test-topic')

      // Announce to peer (fire-and-forget)
      const results = node1.announce(
        { topic: 'test-topic', data: { hello: 'world' } },
        pubkey2
      )

      await Promise.all(results)
      await received
      t.pass('peer received announcement')

      node1.close()
      node2.close()
      await wait_ms(200)
      t.end()
    })

    st.test('announces to multiple peers', async t => {
      const seckey1 = gen_seckey()
      const seckey2 = gen_seckey()
      const seckey3 = gen_seckey()
      const pubkey1 = get_pubkey(seckey1)
      const pubkey2 = get_pubkey(seckey2)
      const pubkey3 = get_pubkey(seckey3)

      const node1 = new NostrNode([pubkey2, pubkey3], urls, seckey1)
      const node2 = new NostrNode([pubkey1], urls, seckey2)
      const node3 = new NostrNode([pubkey1], urls, seckey3)

      await Promise.all([node1.connect(), node2.connect(), node3.connect()])

      const received = Promise.all([wait_for_message(node2, 'broadcast'), wait_for_message(node3, 'broadcast')])

      // Announce to both peers
      const results = node1.announce(
        { topic: 'broadcast', data: 'hello' },
        [pubkey2, pubkey3]
      )

      await Promise.all(results)
      await received
      t.pass('node2 received announcement')
      t.pass('node3 received announcement')

      node1.close()
      node2.close()
      node3.close()
      await wait_ms(200)
      t.end()
    })

    st.end()
  })

  // ───────────────────────────────────────────────────────────────
  // Message Filtering Tests
  // ───────────────────────────────────────────────────────────────

  t.test('Node Message Filtering', async st => {
    st.test('ignores messages from unknown peers', async t => {
      const seckey1 = gen_seckey()
      const seckey2 = gen_seckey()
      const seckey3 = gen_seckey()
      const pubkey1 = get_pubkey(seckey1)
      const pubkey2 = get_pubkey(seckey2)
      const pubkey3 = get_pubkey(seckey3)

      // Node1 only knows about node2, not node3
      const node1 = new NostrNode([pubkey2], urls, seckey1)
      const node2 = new NostrNode([pubkey1], urls, seckey2)
      const node3 = new NostrNode([pubkey1], urls, seckey3)

      await Promise.all([node1.connect(), node2.connect(), node3.connect()])

      let fromNode2 = false
      let fromNode3 = false

      node1.on('message', (msg: RpcMessageData) => {
        if (msg.event.pubkey === pubkey2) fromNode2 = true
        if (msg.event.pubkey === pubkey3) fromNode3 = true
      })

      // node2 announces (should be received)
      const results2 = node2.announce({ topic: 'test', data: 'from2' }, pubkey1)
      await Promise.all(results2)

      // node3 announces (should be filtered)
      const results3 = node3.announce({ topic: 'test', data: 'from3' }, pubkey1)
      await Promise.all(results3)

      await wait_ms(500)

      t.ok(fromNode2, 'received message from known peer')
      t.notOk(fromNode3, 'filtered message from unknown peer')

      node1.close()
      node2.close()
      node3.close()
      await wait_ms(200)
      t.end()
    })

    st.end()
  })

  // ───────────────────────────────────────────────────────────────
  // Encryption Tests
  // ───────────────────────────────────────────────────────────────

  t.test('Node Encryption', async st => {
    st.test('messages are encrypted', async t => {
      const seckey1 = gen_seckey()
      const seckey2 = gen_seckey()
      const pubkey1 = get_pubkey(seckey1)
      const pubkey2 = get_pubkey(seckey2)

      const node1 = new NostrNode([pubkey2], urls, seckey1)
      const node2 = new NostrNode([pubkey1], urls, seckey2)

      await Promise.all([node1.connect(), node2.connect()])

      let decrypted = false
      let rawContent = ''

      node2.on('message', (msg: RpcMessageData) => {
        if (msg.type === 'event') {
          decrypted = true
          rawContent = msg.event.content
        }
      })

      // Send message
      const results = node1.announce({ topic: 'secret', data: 'hidden data' }, pubkey2)
      await Promise.all(results)
      await wait_ms(500)

      t.ok(decrypted, 'message was decrypted')
      t.notOk(rawContent.includes('hidden data'), 'raw content is encrypted')

      node1.close()
      node2.close()
      await wait_ms(200)
      t.end()
    })

    st.end()
  })

  t.teardown(() => {
    relay1.stop()
    relay2.stop()
  })
}
