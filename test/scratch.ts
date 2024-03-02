import { Buff }      from '@cmdcode/buff'
import { Signer }    from '@cmdcode/signer'
import { NostrRoom } from '@cmdcode/nostr-sdk'

const secret = Buff.str('test').digest.hex
const signer = Signer.generate()

const room   = new NostrRoom(secret, signer, {
  debug   : false,
  echo    : true,
  verbose : true
})

room._socket.on('ready', () => {
  console.log('socket is ready')
})

room._store.on('ready', () => {
  console.log('store is ready')
})

room._sub.on('ready', () => {
  console.log('channel is ready')
})

room.on('ready', () => {
  console.log('room is ready')
  //console.log(room.data)
  // room.send('test', JSON.stringify({ msg : 'hello world!' }))
  // store.update({ test : '456' }, [[ 'deleted', 'true' ]])
})

room.on('msg', (msg) => {
  console.log('room msg:', msg)
})

room.on_topic('test', (msg) => {
  console.log('room topic:', msg)
})

room.on('update', () => {
  console.log('room update')
  //console.log(room.data)
})

// room.init('wss://relay.damus.io', { test : '123' })
room.connect('wss://relay.damus.io')
