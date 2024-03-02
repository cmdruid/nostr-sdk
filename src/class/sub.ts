import { Buff }         from '@cmdcode/buff'
import { EventEmitter } from '@/class/emitter.js'
import { NostrSocket }  from '@/class/socket.js'
import { now }          from '@/lib/util.js'

import {
  EventFilter,
  SignedEvent,
  SubscribeConfig
} from '../types.js'

export class NostrSub extends EventEmitter <{
  'cancel'  : NostrSub
  'event'   : SignedEvent
  'ready'   : NostrSub
}> {

  readonly _socket : NostrSocket
  readonly _sub_id : string

  _filter   : EventFilter
  _init     : boolean

  constructor (
    socket : NostrSocket,
    filter : EventFilter,
    config : Partial<SubscribeConfig> = {}
  ) {
    super()
    this._socket = socket
    this._sub_id = config.sub_id ?? Buff.random(32).hex
    this._filter = filter ?? { since : now() }
    this._init   = false
  }

  get filter () {
    return this._filter
  }

  get id () {
    return this._sub_id
  }

  get ready () {
    return this._init
  }

  cancel () {
    this._socket.cancel(this.id)
  }

  async update (filter ?: EventFilter) {
    filter = { ...this.filter, ...filter }
    const sub_id = this.id
    const config = { filter, sub_id }
    return this._socket.subscribe(config)
  }

  when_cancel () {
    return this._socket.when_cancel(this.id)
  }

  when_ready () {
    return this._socket.when_sub(this.id)
  }
}
