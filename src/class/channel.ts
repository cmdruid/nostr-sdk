import { Buff }            from '@cmdcode/buff'
import { SignerAPI }       from '@cmdcode/signer'
import { EventEmitter }    from '@/class/emitter.js'
import { NostrSocket }     from '@/class/socket.js'
import { NostrSub }        from '@/class/sub.js'
import { combine_filters } from '@/lib/filter.js'
import { now }             from '@/lib/util.js'

import {
  decrypt_content,
  encrypt_content
} from '@/lib/crypto.js'

import {
  ChannelConfig,
  EventFilter,
  EventMessage,
  SignedEvent,
  SocketConfig,
  UnsignedEvent
} from '@/types.js'

import * as assert from '@/assert.js'

const CHANNEL_DEFAULTS = () => {
  return {
    debug   : false,
    echo    : false,
    filter  : { since : now() },
    kind    : 20000,
    socket  : null,
    tags    : [],
    verbose : false
  }
}

export class NostrChannel extends EventEmitter <{
  'cancel' : NostrChannel
  'close'  : NostrChannel
  'error'  : [ error : unknown, data : unknown ]
  'msg'    : EventMessage
  'ready'  : NostrChannel
  'reject' : [ reason : string, event : SignedEvent ]
}> {

  readonly _opt    : ChannelConfig
  readonly _signer : SignerAPI

  _filter : EventFilter | null
  _init   : boolean
  _secret : Buff | null
  _socket : NostrSocket | null
  _sub    : NostrSub    | null

  constructor (
    signer : SignerAPI,
    config : Partial<ChannelConfig> = {}
  ) {
    const opt = { ...CHANNEL_DEFAULTS(), ...config }

    super()
    this._opt    = opt
    this._filter = null
    this._init   = false
    this._socket = opt.socket
    this._sub    = null
    this._signer = signer
    this._secret = null
  }

  get address () {
    return this.socket.address
  }

  get filter () {
    return this._filter
  }

  get id () {
    if (this._secret === null) {
      throw new Error('channel not connected')
    }
    return this._secret.digest.hex
  }

  get pubkey () {
    return this._signer.pubkey
  }

  get ready () {
    return this._init
  }

  get secret () {
    if (this._secret === null) {
      throw new Error('channel not connected')
    }
    return this._secret.hex
  }

  get socket () {
    if (this._socket === null) {
      throw new Error('socket not initialized')
    }
    return this._socket
  }

  get sub () {
    if (this._sub === null) {
      throw new Error('channel not initialized')
    }
    return this._sub
  }

  log = {
    debug : (...s : unknown[]) => {
      return (this._opt.debug) ? console.log('[channel]', ...s) : null
    },
    info  : (...s : unknown[]) => {
      return (this._opt.verbose) ? console.log('[channel]', ...s) : null
    }
  }

  _bounce_handler (reason : string, event : SignedEvent) {
    this.log.info(' msg bounced    :', reason)
    this.log.debug('msg bounced    :', event)
    this.emit('reject', [ reason, event ])
  }

  _err_handler (err : unknown, data : unknown) {
    this.log.debug('error:', err)
    this.log.debug('data:', data)
    this.emit('error', [ err, data ])
  }

  _event_handler (event : SignedEvent) {
    if (!this._opt.echo && event.pubkey === this.pubkey) {
      return
    }

    if (!event.content.includes('?iv=')) {
      return this._bounce_handler('message is not encrypted', event)
    }

    let message : [ string, string, any ]

    try {
      const arr = decrypt_content(event.content, this.secret)
      message   = JSON.parse(arr)
    } catch {
      return this._bounce_handler('unable to decrypt message', event)
    }

    const [ subject, hash, body ] = message
    const { content: _, ...rest } = event

    this.log.debug('recv message  :', message)
    this.log.debug('recv envelope :', rest)

    // Build the data payload.
    const msg : EventMessage = { body, envelope : event, hash, subject }

    // Emit the event to our subscribed functions.
    this.emit('msg', msg)
  }

  _initialize (secret : string) {
    assert.is_hex(secret)
    assert.size(secret, 32)
    this._secret = Buff.hex(secret)
    this._filter = combine_filters(this._opt.filter, {
      kinds : [ this._opt.kind ],
      '#d'  : [ this.id ]
    })

    this._sub = this.socket.subscribe(this._filter)
    this.sub.on('cancel',   ()    => void this.emit('cancel', this))
    this.sub.on('event',    (evt) => void this._event_handler(evt))
    this.socket.on('close', ()    => void this.emit('close', this))

    if (!this.ready) {
      this.sub.once('ready', () => {
        this._init = true
        void this.emit('ready', this)
      })
    }
  }

  cancel () {
    this.sub.cancel()
    return this
  }

  async close () {
    await this.socket.close()
    return this
  }

  async connect (
    address : string,
    secret  : string,
    opt    ?: Partial<SocketConfig>
  ) {
    this._socket = this._socket ?? new NostrSocket(opt ?? this._opt)
    this._initialize(secret)
    await this.socket.connect(address)
    return this
  }

  on_topic <T = any> (
    topic : string, 
    fn    : (msg : EventMessage<T>) => void
  ) {
    this.on('msg', (msg) => {
      try {
        if (msg.subject === topic) fn(msg)
      } catch (err) {
        this._err_handler(err, msg)
      }
    })
  }

  async send (
    subject : string,
    body    : string
  ) {
    const hash    = Buff.str(body).digest.hex
    const json    = JSON.stringify([ subject, hash, body ])

    const event : UnsignedEvent = {
      content    : encrypt_content(json, this.secret),
      created_at : now(),
      kind       : this._opt.kind,
      tags       : [ ...this._opt.tags ],
      pubkey     : this.pubkey
    }

    event.tags.push([ 'd', this.id ])

    const signer = (msg : string) => this._signer.sign(msg)
    const signed = await this.socket.sign(event, signer)

    this.socket.publish(signed)
    return this
  }

  refresh () {
    this.sub.update()
  }
}
