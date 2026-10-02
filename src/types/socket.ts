import { NostrSocket } from '@/class/socket.js'

import type {
  RelayEventMessage,
  RelayEOSEMessage,
  RelayReceiptMessage,
  RelayClosedMessage,
  RelayMessage
} from './message.js'

export interface NostrSocketConfig {
  max_retries : number
  queue_ival  : number
  queue_limit : number
  msg_timeout : number
  sub_timeout : number
  /** Maximum messages dispatched per event-loop turn. */
  verify_batch? : number
  /** Maximum queued relay messages before the connection fails closed. */
  receive_limit? : number
}

export interface NostrSocketEvent extends Record<string, any[]> {
  bounce  : [ RelayEventMessage   ],
  closed  : [ NostrSocket         ],
  eose    : [ RelayEOSEMessage    ],
  error   : [ string              ],
  event   : [ RelayEventMessage   ],
  message : [ RelayMessage        ],
  notice  : [ string              ],
  ready   : [ NostrSocket         ],
  receipt : [ RelayReceiptMessage ],
  reject  : [ unknown, string     ],
  unsub   : [ RelayClosedMessage  ]
}
