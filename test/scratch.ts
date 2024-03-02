import { Buff }      from '@cmdcode/buff'
import { Signer }    from '@cmdcode/signer'
import { NostrRoom } from '@cmdcode/nostr-sdk'

const seed   = Buff.str('alice').digest.hex
const signer = new Signer({ seed })

const list = await NostrRoom.list('wss://relay.damus.io', signer)

console.log(list)
