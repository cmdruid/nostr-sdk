import { SignerAPI }    from '@cmdcode/signer'
import { NostrChannel } from './channel.js'
import { EventEmitter } from './emitter.js'
import { NostrSocket }  from './socket.js'
import { NostrStore }   from './store.js'

import {
  EventMessage,
  RoomConfig
} from '@/types.js'

const ROOM_DEFAULTS = () => {
  return {
    debug   : false,
    echo    : false,
    verbose : false
  }
}

export class NostrRoom <T extends {}> extends EventEmitter <{
  'fetch'  : NostrRoom<T>
  'msg'    : EventMessage
  'ready'  : NostrRoom<T>
  'update' : NostrRoom<T>
}>{

  static list = NostrStore.list

  readonly _opt    : RoomConfig
  readonly _socket : NostrSocket
  readonly _store  : NostrStore<T>
  readonly _sub    : NostrChannel

  _init : boolean

  constructor (
    signer   : SignerAPI,
    options ?: Partial<RoomConfig>
  ) {
    const opt    = { ...ROOM_DEFAULTS(), ...options }
    const socket = new NostrSocket(opt)

    super()
    
    this._opt    = opt
    this._socket = socket
    this._store  = new NostrStore(signer, { ...opt, socket })
    this._sub    = new NostrChannel(signer, { ...opt, socket })
    this._init   = false

    this._store.once ('ready',  ()    => void this._ready_check())
    this._store.on   ('fetch',  ()    => void this.emit('fetch', this))
    this._store.on   ('update', ()    => void this.emit('update', this))
    this._sub.once   ('ready',  ()    => void this._ready_check())
    this._sub.on     ('msg',    (msg) => void this.emit('msg', msg))
  }

  get data () {
    return this._store.data
  }

  get store () {
    return this._store.store
  }

  _initialize (secret : string) {
    this._store._initialize(secret)
    this._sub._initialize(secret)
  }

  _ready_check () {
    if (this._store.ready && this._sub.ready) {
      this._init = true
      this.emit('ready', this)
    }
  }

  on_topic <T> (topic : string, fn : (msg: EventMessage<T>) => void) {
    return this._sub.on_topic(topic, fn)
  }

  /**
   * Connect to the room using the specified relay address.
   */
  async connect (
    address : string,
    secret  : string
  ) : Promise<NostrRoom<T>> {
    this._initialize(secret)
    this._store._fetch()
    this._socket.connect(address)
    return this
  }

  delete () {
    return this._store.delete()
  }

  fetch () {
    return this._store.fetch()
  }

  async init (
    address : string,
    data    : T,
    secret  : string
  ) {
    this._initialize(secret)
    this._store.update(data)
    this._socket.connect(address)
    return this
  }

  refresh () {
    return this._store.refresh()
  }

  send (subject : string, body : string) {
    return this._sub.send(subject, body)
  }

  update (
    data        : T, 
    tags       ?: string[][], 
    updated_at ?: number
  ) {
    return this._store.update(data, tags, updated_at)
  }
}