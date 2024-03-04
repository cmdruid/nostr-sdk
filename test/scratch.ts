import { Buff }       from '@cmdcode/buff'
import { Signer }     from '@cmdcode/signer'
import { NostrStore } from '@cmdcode/nostr-sdk'

const addr   = 'wss://relay.damus.io'
const seed   = Buff.str('alice').digest.hex
const signer = new Signer({ seed })
// const query  = await NostrSocket.query(addr, { kinds : [ 1 ], limit : 10 })
const list   = await NostrStore.list(addr, signer)

console.log(list)
