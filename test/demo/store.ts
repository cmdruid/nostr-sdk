import { Buff }       from '@cmdcode/buff'
import { Signer }     from '@cmdcode/signer'
import { NostrStore } from '@cmdcode/nostr-sdk'

const signer = Signer.generate()
const secret = Buff.str('test').digest.hex
const store  = new NostrStore(secret, signer)

store.on('error', console.log)
store.on('reject', console.log)

store.on('update', () => {
  console.log('update')
  console.log(store.data)
})

store.on('ready', async () => {
  console.log('ready')
  console.log(store.data)
  store.update({ test : '456' }, [[ 'deleted', 'true' ]])
})

store.init('wss://relay.damus.io', { test : '123' })
// store.connect('wss://relay.damus.io')
