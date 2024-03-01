import { EventEmitter } from '@/class/emitter.js'
import { NostrSocket }  from '@/class/socket.js'
import { EventMessage } from '@/types.js'

// A channel requires a signer in order to encrypt, decrypt, and publish notes.

// A channel has a secret and topic id.

// A channel has a message bus that is wrapped by the encrypted note.

// This encryption layer is peeled off, then the event topic is emitted.

export default class NostrChannel extends EventEmitter <{
  'close'  : ''
  'error'  : ''
  'msg'    : EventMessage
  'ready'  : ''
  'reject' : ''
}> {

  readonly _socket : NostrSocket

  constructor (
    socket : NostrSocket,
    config : Partial<ChannelConfig> = {}
  ) {
    super()
    this._socket = socket
  }

}
