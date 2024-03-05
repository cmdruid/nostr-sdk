import { Buff }            from '@cmdcode/buff'
import { SignerAPI }       from '@cmdcode/signer'
import { EventEmitter }    from '@/class/emitter.js'
import { NostrSocket }     from '@/class/socket.js'
import { combine_filters } from '@/lib/filter.js'

import {
  has_entry,
  now,
  stringify
} from '@/lib/util.js'

import {
  check_store_key,
  decrypt_content,
  decrypt_store_key,
  encrypt_content,
  encrypt_store_key
} from '@/lib/crypto.js'

import {
  EventFilter,
  SignedEvent,
  SocketConfig,
  StoreConfig,
  StoreItem
} from '../types.js'

import * as assert from '@/assert.js'

function DEFAULT_PARSER <T> (data : unknown) {
  if (typeof data !== 'object') return data as T
  if (data == null)             return data as T
  if (Array.isArray(data))      return [ ...data ] as T
  return { ...data } as T
}

const STORE_DEFAULTS = () => {
  return {
    buffer_timer : 2000,
    debug        : false,
    filter       : { limit : 10 } as EventFilter,
    kind         : 30000,
    parser       : DEFAULT_PARSER,
    socket       : null,
    tags         : [],
    verbose      : false
  }
}

export class NostrStore <T extends Record<string, any>> extends EventEmitter<{
  'close'  : NostrStore<T>
  'error'  : [ error : unknown, data : unknown ]
  'fetch'  : NostrStore<T>
  'ready'  : NostrStore<T>
  'reject' : [ reason : string, event : SignedEvent ]
  'update' : NostrStore<T>
}> {

  static list = fetch_stores

  readonly _opt    : StoreConfig<T>
  readonly _signer : SignerAPI

  _buffer ?: ReturnType<typeof setTimeout>
  _data    : T           | null
  _filter  : EventFilter | null
  _init    : boolean
  _prev    : T           | null
  _secret  : Buff        | null
  _socket  : NostrSocket | null
  _updated : number      | null

  constructor (
    signer  : SignerAPI,
    config ?: Partial<StoreConfig<T>>
  ) {
    const opt = { ...STORE_DEFAULTS(), ...config }

    super()
    this._opt    = opt
    this._signer = signer

    this._buffer  = undefined
    this._data    = null
    this._filter  = null
    this._init    = false
    this._prev    = null
    this._secret  = null
    this._socket  = opt.socket
    this._updated = null
  }

  get data () {
    if (this._data === null) {
      throw new Error('store is not initialized')
    }
    return this._data
  }

  get filter () {
    if (this._filter === null) {
      throw new Error('store is not initialized')
    }
    return this._filter
  }

  get hash () {
    const body = stringify(this.data)
    return Buff.str(body).digest.hex
  }

  get id () {
    if (this._secret === null) {
      throw new Error('store is not initialized')
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
      throw new Error('store is not initialized')
    }
    return this._secret.hex
  }

  get socket () {
    if (this._socket === null) {
      throw new Error('socket not initialized')
    }
    return this._socket
  }

  get store () {
    return new Map(Object.entries(this.data))
  }

  get updated_at () {
    if (this._updated === null) {
      throw new Error('store not initialized')
    }
    return this._updated
  }

  log = {
    debug : (...s : unknown[]) => {
      return (this._opt.debug) ? console.log('[store]', ...s) : null
    },
    info  : (...s : unknown[]) => {
      return (this._opt.verbose)  ? console.log('[store]', ...s) : null
    }
  }

  _bounce_handler (reason : string, event : SignedEvent) {
    this.log.info ('msg bounced    :', reason)
    this.log.debug('msg bounced    :', event)
    this.emit('reject', [ reason, event ])
  }

  _event_filter (event : SignedEvent) {
    if (this._updated === null) {
      return true
    } else {
      return (event.created_at > this._updated)
    }
  }

  _event_handler (event : SignedEvent) {
    if (!this._event_filter(event)) {
      this.log.debug('event filtered  : ', event.id)
      return
    }

    if (!event.content.includes('?iv=')) {
      return this._bounce_handler('store is not encrypted', event)
    }

    const { content, ...rest } = event

    let data : T, store : T | null

    try {
      const json = decrypt_content(content, this.secret)
            data = JSON.parse(json, json_decoder)
    } catch {
      return this._bounce_handler('unable to decrypt store', event)
    }

    try {
      store = this._opt.parser(data)
    } catch (err) {
      this.log.info('invalid data  :', data)
      this.log.debug('invalid data :', err)
      return this._bounce_handler('failed validation', event)
    }

    this.log.debug('recv store    :', store)
    this.log.debug('recv envelope :', rest)

    this._updated = event.created_at

    clearTimeout(this._buffer)

    this._buffer = setTimeout(() => {
      try {
        this._update(data, this.updated_at)
        if (!this.ready) {
          this._init = true
          this.emit('ready', this)
        }
      } catch (err) {
        this._err_handler(err, data)
      }
    }, this._opt.buffer_timer)
  }

  _err_handler (err : unknown, data : unknown) {
    this.log.debug('error:', err)
    this.log.debug('data:', data)
    this.emit('error', [ err, data ])
  }

  _initialize (secret : string) {
    assert.is_hex(secret)
    assert.size(secret, 32)
    this._secret = Buff.hex(secret)
    this._filter = combine_filters(this._opt.filter, {
      kinds : [ this._opt.kind ],
      '#d'  : [ this.id  ]
    })
    this.socket.on('close', () => void this.emit('close', this))
  }

  async _fetch () {
    return this.socket
      .prefetch(this.filter)
      .then(e => e.forEach(evt => this._event_handler(evt)))
  }

  async _send (
    data    : unknown,
    tags    : string[][],
    updated : number
    ) {
    const parsed = this._opt.parser(data)
    const json   = JSON.stringify(parsed, json_encoder)

    const event  = {
      content    : encrypt_content(json, this.secret),
      created_at : updated,
      kind       : this._opt.kind,
      tags       : [ ...this._opt.tags ],
      pubkey     : this.pubkey
    }

    const rec = encrypt_store_key(this.secret, this._signer)

    event.tags.push([ 'd', this.id ])
    event.tags.push([ 'rec', ...rec ])

    tags.forEach(tag => event.tags.push(tag))

    const signer = (msg : string) => this._signer.sign(msg)
    const signed = await this.socket.sign(event, signer)

    this.socket.publish(signed)
    return this
  }

  _update (data : T, updated : number) {
    if (this._updated !== null && updated < this._updated) {
      console.log(`current: ${this._updated} / new: ${updated}`)
      throw new Error('updating with bad timestamp')
    }

    this._updated = updated
    this._prev    = this._data ?? data
    this._data    = data

    if (this.ready) {
      this.emit('update', this)
    }

    this.log.info  (' store updated  :', this.hash)
    this.log.debug (' store updated  :', this.data)

    return this
  }

  async connect (
    address : string, 
    secret  : string,
    opt    ?: Partial<SocketConfig>
  ) {
    this._socket = this._socket ?? new NostrSocket(opt ?? this._opt)
    this._initialize(secret)
    this._fetch()
    await this.socket.connect(address)
    return this
  }

  async close () {
    await this.socket.close()
    return this
  }

  delete () {
    this._send(this.data, [[ 'deleted', 'true' ]], now())
  }

  async fetch () {
    await this._fetch()
    this.emit('fetch', this)
    return this
  }

  async init (
    address : string,
    secret  : string,
    store   : T, 
    opt    ?: Partial<SocketConfig>
  ) {
    this._socket = this._socket ?? new NostrSocket(opt ?? this._opt)

    this.socket.once('ready', () => {
      this._init = true
      this.emit('ready', this)
    })

    this._initialize(secret)
    this.update(store)
    this.socket.connect(address)
    return this
  }

  refresh () {
    this._updated = null
    return this.fetch()
  }

  toString () {
    return JSON.stringify(this.data, null, 2)
  }

  toJSON () {
    return this.data
  }

  update (
    data       : T,
    updated_at : number = now()
  ) {
    this._update(data, updated_at)
    this._send(data, [], updated_at)
    return this
  }

  [Symbol.iterator] () {
    return this.store[Symbol.iterator]()
  }
}

/**
 * Fetch a list of recoverable stores from the relay.
 * @param address 
 * @param signer 
 * @param filter 
 * @param options 
 * @returns 
 */
async function fetch_stores (
  address  : string,
  signer   : SignerAPI,
  filter  ?: EventFilter,
  options ?: Partial<SocketConfig>
) : Promise<StoreItem[]> {
  // Set a default filter if none is provided.
  filter = filter ?? { kinds : [ 30000 ] }
  // Add the signer as an author to the filter.
  filter = combine_filters(filter, {
    authors : [ signer.pubkey ]
  })
  // Define an array to store our results.
  let result : StoreItem[] = []
  // Query the relay for events.
  const query  = await NostrSocket.query(address, filter, options)
  // Filter the events for recoverable stores.
  const stores = query
    .filter(e => !has_entry('deleted', e.tags))
    .filter(e => check_store_key(e, signer))
  // Convert each store event into a list item.
  stores.forEach(e => {
    try {
      const { created_at, id, pubkey } = e
      const secret   = decrypt_store_key(e, signer)
      const topic_id = Buff.hex(secret).digest.hex
      result.push({ pubkey, secret, topic_id, store_id : id, updated_at : created_at })
    } catch {}
  })
  // Return the resulting list items.
  return result
}

function json_encoder (_key : string, value : any) {
  // Convert non-standard javascript objects to json.
  if (value instanceof Map)
    return { type: 'Map', value: [ ...value ] }
  if (value instanceof Date)
    return { type: 'Date', value: value }
  return value
}

function json_decoder (_key : string, value : any) {
  // Convert non-standard json objects to javascript.
  if (typeof value === 'object' && value !== null) {
    if (value.type === 'Map') return new Map(value.value)
    if (value.type === 'Date') return new Date(value.value)
  }
  return value
}
