import { Buff }      from '@cmdcode/buff'
import { Signer }    from '@cmdcode/signer'
import { NostrRoom } from '@cmdcode/nostr-sdk'

const address = 'wss://relay.damus.io' 
const seed    = Buff.str('alice').digest.hex
const signer  = new Signer({ seed })

const stores = await NostrRoom.list(address, signer, undefined, { verbose : true })

console.log('stores:')

console.dir(stores, { depth: null })
