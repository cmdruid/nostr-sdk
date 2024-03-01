import { NostrSocket } from '@/index.js'
import { now } from '@/lib/util.js'

const socket = new NostrSocket()

socket.on('ready', () => {
  console.log('socket is ready')
  // socket.close()
})

const sub = socket.subscribe({ kinds : [ 0, 1 ], since : now() })

sub.on('ready', () => {
  console.log('sub is ready')
})

sub.on('event', (event) => {
  console.log('event:', event)
})

await socket.connect('wss://relay.damus.io')
