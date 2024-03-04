import { Buff }       from '@cmdcode/buff'
import { Signer }     from '@cmdcode/signer'
import { NostrStore } from '@cmdcode/nostr-sdk'

const address = 'wss://relay.damus.io' 
const seed    = Buff.str('alice').digest.hex
const signer  = new Signer({ seed })
const stores  = await NostrStore.list(address, signer, undefined, { verbose : true, debug: true })

console.dir(stores, { depth: null })
