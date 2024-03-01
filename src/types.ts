import { NostrSocket } from './class/socket.js'

export type ReceiptEnvelope = [
  id : string,
  ok : boolean,
  reason : string
]

export interface EventMessage <T = any> {
  body     : T
  envelope : SignedEvent
  hash     : string
  subject  : string
}

export type EventFilter = {
  ids     ?: string[]
  authors ?: string[]
  kinds   ?: number[]
  since   ?: number
  until   ?: number
  limit   ?: number
} & { [ key : string ] : any | undefined }

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

export interface SocketConfig {
  connect_retries : number
  connect_timeout : number
  echo_timeout    : number
  receipt_timeout : number
  send_delta      : number
  debug           : boolean
  verbose         : boolean
}

export interface StoreConfig<T> extends SocketConfig {
  buffer_timer  : number
  refresh_ival  : number
  update_timer  : number
  parser       ?: (data : unknown) => Promise<T>
  socket       ?: NostrSocket
}

export interface SubscribeConfig {
  filter : EventFilter
  echo   : boolean
  sub_id : string
}
