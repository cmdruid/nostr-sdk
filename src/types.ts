import { NostrSocket } from "./index.js"

export type ReceiptEnvelope = [
  id : string,
  ok : boolean,
  reason : string
]

export interface ChannelConfig {
  debug   : boolean
  echo    : boolean
  filter  : EventFilter
  kind    : number
  socket  : NostrSocket | null
  tags    : string[][]
  verbose : boolean
}

export interface EventMessage <T = any> {
  body     : T
  envelope : SignedEvent
  hash     : string
  subject  : string
}

export interface EventFilter {
  ids     ?: string[]
  authors ?: string[]
  kinds   ?: number[]
  since   ?: number
  until   ?: number
  limit   ?: number
  [ key : string ] : any | undefined
}

export interface UnsignedEvent {
  content    : string
  created_at : number
  kind       : number
  pubkey     : string
  tags       : string[][]
}

export interface SignedEvent extends UnsignedEvent {
  id         : string
  sig        : string
}

export interface RoomConfig {
  debug   : boolean
  echo    : boolean
  verbose : boolean
}

export interface SocketConfig {
  connect_retries : number
  connect_timeout : number
  receipt_timeout : number
  send_delta      : number
  debug           : boolean
  verbose         : boolean
}

export interface StoreConfig<T> {
  buffer_timer : number
  debug        : boolean
  filter       : EventFilter
  kind         : number
  parser       : (data : unknown) => T
  socket       : NostrSocket | null
  tags         : string[][]
  verbose      : boolean
}

export interface StoreItem {
  pubkey     : string
  secret     : string
  store_id   : string
  topic_id   : string
  updated_at : number
}

export interface SubscribeConfig {
  socket : NostrSocket | null
  sub_id : string
}
