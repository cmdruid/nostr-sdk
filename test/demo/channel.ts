import { Buff }         from '@cmdcode/buff'
import { Signer }       from '@cmdcode/signer'
import { NostrChannel } from '@cmdcode/nostr-sdk'

const signer = Signer.generate()
const secret = Buff.str('test').digest.hex
const chan   = new NostrChannel(secret, signer, { echo : true })

chan.on('error', console.log)
chan.on('reject', console.log)

chan.on('msg', (msg) => {
  console.log('msg', msg)
})

chan.on_topic('test', (msg) => {
  console.log('topic')
  console.log(msg)
  chan.close()
})

chan.on('ready', () => {
  console.log('ready')
  chan.send('test', JSON.stringify({ msg : 'hello world!' }))
})

chan.connect('wss://relay.damus.io', { verbose : true })
