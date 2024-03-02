import { Buff }         from '@cmdcode/buff'
import { EventEmitter } from '@/class/emitter.js'
import { NostrSocket }  from '@/class/socket.js'
import { now }          from '@/lib/util.js'

import {
  EventFilter,
  SignedEvent,
  SubscribeConfig
} from '../types.js'

const SOCKET_DEFAULTS = () => {
  return {
    socket : null,
    sub_id : Buff.random(32).hex
  }
}

export class NostrSub extends EventEmitter <{
  'cancel'  : NostrSub
  'event'   : SignedEvent
  'ready'   : NostrSub
}> {

  readonly _opt    : SubscribeConfig
  readonly _socket : NostrSocket
  readonly _sub_id : string

  _filter   : EventFilter
  _init     : boolean

  constructor (
    socket   : NostrSocket,
    filter  ?: EventFilter,
    options ?: Partial<SubscribeConfig>
  ) {
    const opt = { ...SOCKET_DEFAULTS(), ...options }
    super()
    this._opt    = opt
    this._socket = socket
    this._sub_id = opt.sub_id
    this._filter = filter ?? { since : now() }
    this._init   = false
    
  }

  get filter () {
    return this._filter
  }

  get sub_id () {
    return this._opt.sub_id
  }

  get ready () {
    return this._init
  }

  cancel () {
    this._socket.cancel(this.sub_id)
  }

  async update (filter ?: EventFilter) {
    this._filter = filter ?? this.filter
    return this._socket.subscribe(this.filter, this._opt)
  }

  when_cancel () {
    return this._socket.when_cancel(this.sub_id)
  }

  when_ready () {
    return this._socket.when_sub(this.sub_id)
  }
}
