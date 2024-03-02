import { Buff }   from '@cmdcode/buff'
import { Signer } from '@cmdcode/signer'

import {
  NostrChannel,
  NostrSocket,
  NostrStore
} from '@cmdcode/nostr-sdk'
import { sleep } from '@/lib/util.js'

const socket = new NostrSocket({ verbose : true })

socket.on('ready', () => {
  console.log('socket is ready')
})

socket.on('notice', console.log)
socket.on('error', console.log)

const signer = Signer.generate()
const secret = Buff.str('test').digest.hex

const chan   = new NostrChannel(secret, signer, { echo: true, socket })
const store  = new NostrStore(secret, signer, { socket })

chan.on('error', console.log)
chan.on('reject', console.log)

chan.on('msg', (msg) => {
  console.log('channel msg:', msg)
})

chan.on_topic('test', (msg) => {
  console.log('channel topic:', msg)
})

chan.on('ready', () => {
  console.log('channel ready')
  chan.send('test', JSON.stringify({ msg : 'hello world!' }))
})

store.on('error', console.log)
store.on('reject', console.log)

store.on('update', () => {
  console.log('store update')
  console.log(store.data)
})

store.on('ready', () => {
  console.log('store ready')
  console.log(store.data)
  // store.update({ test : '456' }, [[ 'deleted', 'true' ]])
})

// store.init('wss://relay.damus.io', { test : '123' })
socket.connect('wss://relay.damus.io')

await sleep(7000)

socket.connect('wss://nostr.lol')
