import { Buff }       from '@cmdcode/buff'
import { Signer }     from '@cmdcode/signer'
import { NostrStore } from '@cmdcode/nostr-sdk'

const seed   = Buff.str('alice').digest.hex
const signer = new Signer({ seed })
const secret = Buff.str('test').digest.hex
const store  = new NostrStore(signer)

store.on('error', console.log)
store.on('reject', console.log)

store.on('update', () => {
  console.log('update')
  console.log(store.data)
})

store.on('ready', async () => {
  console.log('ready')
  console.log(store.data)
  // store.update({ test : '456' }, [[ 'deleted', 'true' ]])
})

store.on('fetch', () => {
  console.log('fetch')
})

// store.init('wss://relay.damus.io', { test : '123' })
await store.connect('wss://relay.damus.io', secret)
