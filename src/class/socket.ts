import WebSocket from 'isomorphic-ws'

import { Buff }         from '@cmdcode/buff'
import { verify_sig }   from '@cmdcode/crypto-tools/signer'
import { EventEmitter } from '@/class/emitter.js'
import { NostrSub }     from '@/class/sub.js'
import { sleep }        from '../lib/util.js'

import { parse_signed_note } from '@/lib/parse.js'

import {
  EventFilter,
  EventMessage,
  ReceiptEnvelope,
  SocketConfig,
  SubscribeConfig,
  SignedEvent,
  UnsignedEvent,
} from '../types.js'

const SOCKET_DEFAULTS = () : SocketConfig => {
  return {
    connect_retries : 10,
    connect_timeout : 500,
    send_delta      : 1000,
    receipt_timeout : 4000,
    debug           : false,
    verbose         : false,
  }
}

export class NostrSocket extends EventEmitter <{
  'cancel'    : [ id : string, sub : NostrSub, reason : string ]
  'connected' : NostrSocket
  'close'     : NostrSocket
  'error'     : Error
  'event'     : EventMessage
  'notice'    : string
  'ready'     : NostrSocket
  'reject'    : [ reason : string, event : string ]
  'receipt'   : ReceiptEnvelope
  'subscribe' : [ id : string, sub : NostrSub ]
}> {

  static connect (address : string, opt ?: Partial<SocketConfig>) {
    const socket = new NostrSocket(opt)
    return socket.connect(address)
  }

  static query (
    address : string, 
    filter  : EventFilter, 
    opt    ?: Partial<SocketConfig>
  ) {
    const socket = new NostrSocket(opt)
    const events = socket.prefetch(filter, true)
    socket.connect(address)
    return events
  }

  readonly _opt : SocketConfig

  _address  : string | null
  _buffer  ?: ReturnType<typeof setTimeout>
  _init     : boolean
  _outbox   : SignedEvent[]
  _socket   : WebSocket | null
  _subs     : Map<string, NostrSub>

  constructor (options ?: Partial<SocketConfig>) {
    super()
    this._opt      = { ...SOCKET_DEFAULTS(), ...options }
    this._address  = null
    this._init     = false
    this._outbox   = []
    this._socket   = null
    this._subs     = new Map()
  }

  get address () {
    if (this._address === null) {
      throw new Error('socket relay is undefined')
    }
    return this._address
  }

  get opt () {
    return this._opt
  }

  get connected () {
    return (
      this._socket !== null && 
      this._socket.readyState === 1
    )
  }

  get ready () {
    return this._init
  }

  get socket () {
    if (this._socket === null) {
      throw new Error('socket relay is undefined')
    }
    return this._socket
  }

  get subs () {
    return this._subs
  }

  log = {
    debug : (...s : unknown[]) => {
      return (this.opt.debug) ? console.log('[socket]', ...s) : null
    },
    info  : (...s : unknown[]) => {
      return (this.opt.verbose) ? console.log('[socket]', ...s) : null
    }
  }

  _bounce_handler (reason : string, event : string) {
    this.log.debug(reason, event)
    this.emit('reject', [ reason, event ])
  }

  _err_handler (err : unknown) {
    const error = (err instanceof Error)
      ? err
      : new Error(String(err))
    this.log.debug('error:', err)
    this.emit('error', error)
  }

  async _event_handler (payload : string[]) {
    const [ sub_id, json ] = payload

    const sub = this.subs.get(sub_id)

    if (sub === undefined) {
      return this._bounce_handler('missing subscription for event', json)
    }

    const event = await parse_signed_note(json)

    if (event === null) {
      return this._bounce_handler('event failed validation', json)
    }

    const { created_at, id, pubkey, sig } = event

    this.log.info('event sub      :', sub_id)
    this.log.info('event id       :', id)
    this.log.info('event date     :', new Date(created_at * 1000))

    if (!verify_sig(sig, id, pubkey)) {
      return this._bounce_handler('invalid signature for event', json)
    }

    sub.emit('event', event)
  }

  _msg_handler (msg : any) {
    try {
      const payload = msg['data']
      const [ type, ...rest ] = JSON.parse(payload)
      switch (type) {
        case 'EOSE':
          return this._eose_handler(rest)
        case 'EVENT':
          return this._event_handler(rest)
        case 'OK':
          return this._receipt_handler(rest)
        case 'CLOSED':
          return this._cancel_handler(rest)
        case 'NOTICE':
          return this._notice_handler(rest)
        default:
          this.log.debug('unknown payload:', type, type.length)
      }
    } catch (err) {
      this._err_handler(err)
    }   
  }

  _cancel_handler (payload : string[]) {
    const [ sub_id, reason ] = payload
    if (this.subs.has(sub_id)) {
      const sub = this.get_sub(sub_id)
      sub._init = false
      sub.emit('cancel', sub)
      this.subs.delete(sub_id)
      this.log.info('sub canceled   :', sub_id, reason)
      this.emit('cancel', [ sub_id, sub, reason ])
    }
  }

  _eose_handler (payload : string[]) {
    const [ sub_id ] = payload
    const sub = this.get_sub(sub_id)
    sub._init = true
    this.log.info('sub active     :', sub_id)
    sub.emit('ready', sub)
    this.emit('subscribe', [ sub_id, sub ])
  }

  _open_handler (_event : unknown) {
    /** Handle the socket open event. */
    this.log.info('connected to   :', this.address)
  }

  _notice_handler (payload : string[]) {
    const [ msg ] = payload
    this.log.info('server notice:', msg)
    this.emit('notice', msg)
  }

  _receipt_handler (payload : ReceiptEnvelope) {
    const [ id, ok, ok_reason ] = payload
    this.log.info('event receipt  :', id, ok ? 'ok' : ok_reason)
    this.emit('receipt', payload)
  }

  _publish (events : SignedEvent[] = []) {
    let delay  = 0 
    const arr  = [ ...this._outbox, ...events ]
    const prom = arr.map(async (event) => {
      const req = [ 'EVENT', event ]
      this.socket.send(JSON.stringify(req))
      await sleep(delay)
      delay += this.opt.send_delta
    })
    this._outbox = []
    return Promise.all(prom)
  }

  _subscribe (subs ?: [ string, NostrSub ][]) {
    let delay  = 0 
    const arr  = subs ?? [ ...this.subs ]
    const prom = arr.map(async ([ sub_id, sub ]) => {
      const req = [ 'REQ', sub_id, sub.filter ]
      this.socket.send(JSON.stringify(req))
      await sleep(delay)
      delay += this.opt.send_delta
    })
    return Promise.all(prom)
  }

  cancel (sub_id : string) {
    if (this.subs.has(sub_id)) {
      if (this.connected) {
        const sub_req = [ 'CLOSE', sub_id ]
        this.socket.send(JSON.stringify(sub_req))
      }
      this.log.info('cancelling sub :', sub_id)
      this._cancel_handler([ sub_id, '' ])
    }
  }

  async connect (address ?: string) {
    const new_address = (address !== undefined && address !== this._address)

    if (new_address) {
      this._address = address
    }

    if (!this._address) {
      throw new Error('Must provide a valid relay address!')
    }

    if (
      new_address           ||
      this._socket === null ||
      this.socket.readyState > 1
    ) {
      this._socket = new WebSocket(this.address)
      this.socket.addEventListener('error',   (event) => this._err_handler(event))
      this.socket.addEventListener('open',    (event) => this._open_handler(event))
      this.socket.addEventListener('message', (event) => this._msg_handler(event))
    }

    if (!this.connected) {
      await this.when_connected() 
      await this._subscribe()
      await this._publish()
      if (!this.ready) {
        this._init = true
        this.emit('ready', this)
      } else {
        this.emit('connected', this)
      }
    }

    return this
  }

  close () {
    this.socket.close()
    this.subs.forEach(e => e.cancel())
    this.emit('close', this)
  }

  get_sub (sub_id : string) {
    const sub = this.subs.get(sub_id)
    if (sub === undefined) {
      throw new Error('subscription does not exist: ' + sub_id)
    }
    return sub
  }

  publish (event : SignedEvent) {
    const { content, ...rest } = event

    this.log.info('event publish  :', rest.id)
    this.log.debug('send message   :', content)
    this.log.debug('send envelope  :', rest)

    if (!this.connected) {
      this.log.info('buffered evt   : ' + event.id)
      this._outbox.push(event)
    } else {
      this._publish([ event ])
    }
  }

  async prefetch (filter : EventFilter, close = false) {
    const events : SignedEvent[] = []
    const sub = this.subscribe(filter)
    sub.on('event', (event) => void events.push(event))
    sub.once('ready', (sub) => {
      if (close) {
        this.close()
      } else {
        sub.cancel()
      }
    })
    await sub.when_ready()
    return events
  }

  async send (
    event  : UnsignedEvent,
    signer : (msg : string) => string | Promise<string>
  ) {
    // Sign our message.
    const signed  = await this.sign(event, signer)
    // Create a receipt promise.
    const receipt = this.when_receipt(signed.id)
    // Publish the signed event.
    this.publish(signed)
    // Return the promises.
    return receipt
  }

  async sign (
    event  : UnsignedEvent,
    signer : (msg : string) => string | Promise<string>
  ) {
    const id  = get_event_id(event)
    const sig = await signer(id)
    return { ...event, id, sig }
  }

  subscribe (
    filter  : EventFilter,
    config ?: Partial<SubscribeConfig>
  ) {
    /** Send a subscription message to the socket peer. */
    const sub = new NostrSub(this, filter, config)  

    this.subs.set(sub.sub_id, sub)

    if (this.connected) {
      this.log.info('buffered sub   : ' + sub.sub_id)
      this._subscribe([[ sub.sub_id, sub ]])
    } else {
      this.log.info('registered sub : ' + sub.sub_id)
    }

    this.log.debug('sub filter:', filter)

    return sub
  }

  async when_cancel (sub_id : string) {
    const duration = this.opt.receipt_timeout
    const timeout  = 'cancel receipt timed out'
    return new Promise((res, rej) => {
      const timer = setTimeout(() => rej(timeout), duration)
      this.within('cancel', ([ id ]) => {
        if (id === sub_id) {
          this.log.info('cancel confirm  : ' + sub_id)
          clearTimeout(timer)
          res(id)
        }
      }, duration)
    }).catch(err => { throw new Error(err) })
  }

  async when_connected () {
    const duration = this.opt.connect_timeout
    const retries  = this.opt.connect_retries
    const timeout  = 'failed to connect'
    return new Promise((res, rej) => {
      let counter  = 0
      let interval = setInterval(async () => {
        if (this.connected) {
          clearInterval(interval)
          res(this)
        } else if (counter > retries) {
          clearInterval(interval)
          rej(timeout)
        } else { counter++ }
      }, duration)
    }).catch(err => { throw new Error(err) })
  }

  async when_receipt (event_id : string) {
    const duration = this.opt.receipt_timeout
    const timeout  = 'message receipt timed out'
    return new Promise((res, rej) => {
      const timer = setTimeout(() => rej(timeout), duration)
      this.within('receipt', ([ id, ok, reason ]) => {
        if (id === event_id) {
          this.log.debug('event confirm  : ' + event_id)
          clearTimeout(timer)
          return (ok) ? res(id) : rej(reason)
        }
      }, duration)
    }).catch(err => { throw new Error(err) })
  }

  async when_sub (sub_id : string) {
    const duration = this.opt.receipt_timeout
    const timeout  = 'subscription receipt timed out'
    return new Promise((res, rej) => {
      const timer = setTimeout(() => rej(timeout), duration)
      this.within('subscribe', ([ id ]) => {
        if (id === sub_id) {
          this.log.debug('sub confirm    : ' + sub_id)
          clearTimeout(timer)
          res(id)
        }
      }, duration)
    }).catch(err => { throw new Error(err) })
  }

}

function get_event_id (event : Partial<SignedEvent>) {
  const preimg = JSON.stringify([
    0,
    event['pubkey'],
    event['created_at'],
    event['kind'],
    event['tags'],
    event['content'],
  ])
  return Buff.str(preimg).digest.hex
}
