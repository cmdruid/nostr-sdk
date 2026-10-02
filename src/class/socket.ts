import { EventEmitter }      from '@/class/emitter.js'
import { MessageQueue }      from '@/class/queue.js'
import { NostrSubscription } from '@/class/sub.js'

import {
  parse_relay_message,
  match_any_filter,
  match_filter,
  validate_client_message,
  verify_event,
  wait_for_ready
} from '@/lib/index.js'

import type {
  ClientMessage,
  EventFilter,
  NostrSocketConfig,
  SignedEvent,
  PublishResponse,
  RelayReceiptMessage,
  NostrSocketEvent,
  RelayNoticeMessage,
  RelayEventMessage,
  RelayMessage,
  SubscriptionFilterOptions
} from '@/types/index.js'

/** Default configuration for NostrSocket instances. */
export const SOCKET_CONFIG : Required<NostrSocketConfig> = {
  max_retries : 3,
  queue_ival  : 500,
  queue_limit : 10,
  msg_timeout : 5000,
  sub_timeout : 30000,
  verify_batch : 16,
  receive_limit : 256
}

/**
 * WebSocket connection to a single Nostr relay.
 * Handles message parsing, event publishing, and subscription management.
 */
export class NostrSocket extends EventEmitter <NostrSocketEvent> {
  private readonly _config : Required<NostrSocketConfig>
  private readonly _queue  : MessageQueue
  private readonly _subs   : Map<string, NostrSubscription> = new Map()
  private readonly _url    : string
  private readonly _requests : Map<string, EventFilter[]> = new Map()

  private readonly _filterCounts = new Map<string, number[]>()
  private readonly _historyComplete = new Set<string>()
  private _incoming : RelayMessage[] = []
  private _receiveTimer : ReturnType<typeof setTimeout> | undefined
  private _receiveBudget = 0
  private _reconnectTimer : ReturnType<typeof setTimeout> | undefined
  private _retries = 0
  private _overflowRecovery = false
  private _closed      : boolean = false
  private _closeTimer  : NodeJS.Timeout | undefined
  private _init        : boolean = false
  private _ws          : WebSocket | null

  /** Bound listener references for proper cleanup. */
  private readonly _handlers : Map<string, EventListener> = new Map()

  /**
   * Creates a new NostrSocket connection to a relay.
   * @param relay    WebSocket URL (ws:// or wss://) or existing WebSocket instance
   * @param options  Optional configuration overrides
   * @throws Error   If URL is not a valid WebSocket URL
   */
  constructor (
    relay   : string | WebSocket,
    options : Partial<NostrSocketConfig> = {}
  ) {
    // Initialize the class.
    super()
    // Initialize the configuration.
    this._config = { ...SOCKET_CONFIG, ...options }
    for (const key of ['verify_batch', 'receive_limit'] as const) {
      const value = this._config[key]
      if (!Number.isSafeInteger(value) || value < 1) throw new Error(`invalid ${key}`)
    }
    this._receiveBudget = this._config.verify_batch
    // Initialize the queue.
    this._queue  = new MessageQueue(this)
    // Handle string URL vs WebSocket instance.
    if (typeof relay === 'string') {
      // Validate the WebSocket URL.
      if (!relay.startsWith('ws://') && !relay.startsWith('wss://')) {
        throw new Error(`invalid WebSocket URL: ${relay}`)
      }
      this._url = relay
      this._ws  = null  // Defer connection until connect() is called
    } else {
      // Use provided WebSocket directly.
      this._url = relay.url
      this._ws  = relay
      // Attach listeners to the provided WebSocket.
      this._attach_listeners()
    }
  }

  /**
   * Attaches event listeners to the WebSocket.
   * Stores references for cleanup.
   */
  private _attach_listeners () {
    if (!this._ws) return
    const ws = this._ws
    // Define handlers as tuples for iteration.
    const handlers : [ string, EventListener ][] = [
      [ 'open',    () => this._open() ],
      [ 'close',   () => this._close() ],
      [ 'error',   (e : Event) => this._on_error(e) ],
      [ 'message', (e : Event) => this._on_message((e as MessageEvent).data) ],
    ]
    // Attach all handlers.
    for (const [ event, handler ] of handlers) {
      this._handlers.set(event, handler)
      ws.addEventListener(event, handler)
    }
  }

  /**
   * Removes event listeners from the WebSocket.
   */
  private _remove_listeners () {
    if (!this._ws) return
    // Remove all handlers.
    for (const [ event, handler ] of this._handlers) {
      this._ws.removeEventListener(event, handler)
    }
    this._handlers.clear()
  }

  /** Current socket configuration. */
  get config () {
    return this._config
  }

  /** Whether the WebSocket connection is established and ready. */
  get is_ready () {
    return this._init && this._ws?.readyState === WebSocket.OPEN
  }

  /** Map of active subscriptions by subscription ID. */
  get subs () {
    return this._subs
  }

  /** The relay WebSocket URL. */
  get url () {
    return this._url
  }

  /** The underlying WebSocket instance. */
  get ws () {
    if (!this._ws) {
      throw new Error(`WebSocket not initialized for ${this.url}`)
    }
    return this._ws
  }

  private _close () {
    this._init = false
    this._requests.clear()
    this._filterCounts.clear()
    this._historyComplete.clear()
    // Clear the close timer if it exists.
    clearTimeout(this._closeTimer)
    // Clear the message queue.
    this._queue.clear()
    this._clear_incoming()
    // Remote disconnects suspend subscriptions; explicit close cancels them.
    for (const sub of this._subs.values()) {
      if (this._closed || !sub.persistent) sub._fail('relay disconnected')
      else sub._pause()
    }
    // Remove event listeners from the WebSocket.
    this._remove_listeners()
    // Set the socket to not initialized.
    this._init = false
    // Emit a closed event.
    this.emit('closed', this)
    this._schedule_reconnect()
  }

  private _on_error (error : unknown) {
    // Emit an error event.
    this.emit('error', String(error))
  }

  private _on_event (msg : RelayEventMessage) {
    // Extract the event from the message.
    const event = msg[2]
    // Reject unsolicited and irrelevant traffic before expensive hashing/Schnorr
    // checks. Every event that can reach consumers is still fully verified.
    const filters = this._subs.get(msg[1])?.filters ?? this._requests.get(msg[1])
    if (!filters || !match_any_filter(event, filters)) return
    const counts = this._filterCounts.get(msg[1]) ?? filters.map(() => 0)
    const eligible = filters.map((filter, index) => match_filter(event, filter) &&
      (this._historyComplete.has(msg[1]) || filter.limit === undefined || counts[index] < filter.limit))
    if (!eligible.some(Boolean)) return
    // Verify the event signature and integrity.
    const error = verify_event(event)
    // If validation fails, emit reject and return early.
    if (error !== null) {
      return this.emit('reject', event, error)
    }
    if (!this._historyComplete.has(msg[1])) {
      eligible.forEach((matches, index) => { if (matches) counts[index]++ })
      this._filterCounts.set(msg[1], counts)
    }
    // Subscribers listen to message, so deliver only after verification.
    this.emit('message', msg)
    // Emit the validated event.
    this.emit('event', msg)
  }

  /** Whether this request still has received messages awaiting verification. */
  public has_pending_messages (sub_id : string) {
    return this._incoming.some(msg => (msg[0] === 'EVENT' || msg[0] === 'EOSE' || msg[0] === 'CLOSED') && msg[1] === sub_id)
  }

  private _clear_incoming () {
    clearTimeout(this._receiveTimer)
    this._receiveTimer = undefined
    this._incoming = []
    this._receiveBudget = this.config.verify_batch
  }

  private _drain_incoming () {
    while (!this._closed && this._receiveBudget > 0 && this._incoming.length > 0) {
      this._receiveBudget--
      const msg = this._incoming.shift()
      if (!msg) break
      // Keep control messages behind preceding EVENT verification.
      if (msg[0] === 'CLOSED') { this._requests.delete(msg[1]); this._filterCounts.delete(msg[1]); this._historyComplete.delete(msg[1]) }
      if (msg[0] === 'EOSE') {
        this._historyComplete.add(msg[1])
        if (this._subs.has(msg[1])) { this._overflowRecovery = false; this._retries = 0 }
      }
      if (msg[0] !== 'EVENT') this.emit('message', msg)
      switch (msg[0]) {
        case 'EVENT' : this._on_event(msg); break
        case 'NOTICE' : this._on_notice(msg); break
        case 'OK' : this._on_receipt(msg); break
      }
    }
    if (!this._closed && !this._receiveTimer) {
      this._receiveTimer = setTimeout(() => {
        this._receiveTimer = undefined
        this._receiveBudget = this.config.verify_batch
        if (this._incoming.length > 0) this._drain_incoming()
      }, 0)
    }
  }

  // Bound cryptographic work per turn and retained backlog, without allowing
  // EOSE to overtake verification. Overload fails the connection closed.
  private _on_message (message : unknown) {
    if (this._closed || (this._ws && this._ws.readyState >= WebSocket.CLOSING)) return
    try {
      const parsed = parse_relay_message(message)
      if (!parsed.ok) return this.emit('reject', message, 'invalid message')
      const msg = parsed.result
      if (msg[0] === 'EVENT') {
        const filters = this._subs.get(msg[1])?.filters ?? this._requests.get(msg[1])
        if (!filters || !filters.some((filter, index) => match_filter(msg[2], filter) && (this._historyComplete.has(msg[1]) || filter.limit === undefined || (this._filterCounts.get(msg[1])?.[index] ?? 0) < filter.limit))) return
      }
      if (this._incoming.length >= this.config.receive_limit) {
        this._overflowRecovery = true
        this._on_error('relay verification backlog exceeded')
        this._clear_incoming()
        for (const sub of this._subs.values()) {
          if (!sub.persistent || this._retries >= this.config.max_retries) sub._fail('relay verification backlog exceeded')
          else sub._pause()
        }
        this._ws?.close()
        return
      }
      this._incoming.push(msg)
      this._drain_incoming()
    } catch (err : unknown) {
      this._on_error(err)
    }
  }

  private _schedule_reconnect () {
    if (this._closed || !Array.from(this._subs.values()).some(sub => sub._needs_reconnect()) || this._reconnectTimer || this._retries >= this.config.max_retries) return
    this._retries++
    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = undefined
      if (this._closed || this._subs.size === 0) return
      void this.connect().catch(() => this._schedule_reconnect())
    }, this.config.queue_ival)
    if (typeof this._reconnectTimer.unref === 'function') this._reconnectTimer.unref()
  }

  private _on_notice (msg : RelayNoticeMessage) {
    // Emit a notice event.
    this.emit('notice', msg[1])
  }

  private _on_receipt (msg : RelayReceiptMessage) {
    // Emit a receipt event.
    this.emit('receipt', msg)
  }

  private _open () {
    if (this._closed) {
      this._ws?.close()
      return
    }
    // If the socket is already initialized, return.
    if (this.is_ready) return
    // Set the socket to initialized.
    this._init = true
    if (!this._overflowRecovery) this._retries = 0
    clearTimeout(this._reconnectTimer)
    this._reconnectTimer = undefined
    for (const sub of this._subs.values()) sub._resume()
    // Emit a ready event.
    this.emit('ready', this)
  }

  public _send (msg : ClientMessage) {
    // Validate the message.
    validate_client_message(msg)
    // Add the message to the queue.
    this.ws.send(JSON.stringify(msg))
  }

  /**
   * Closes the WebSocket connection after a delay.
   * @param delay  Delay in ms before closing (default: 100)
   */
  public close (delay : number = 100) {
    // Clear any existing close timer to prevent multiple close attempts.
    clearTimeout(this._closeTimer)
    // Mark socket as closed immediately so new operations fail.
    this._init = false
    // Mark socket as permanently closed to prevent reconnection.
    this._closed = true
    clearTimeout(this._reconnectTimer)
    this._reconnectTimer = undefined
    this._clear_incoming()
    for (const sub of this._subs.values()) sub.cancel()
    this._queue.clear()
    this._requests.clear()
    this._filterCounts.clear()
    this._historyComplete.clear()
    // Setup a timer to close the connection.
    this._closeTimer = setTimeout(() => {
      // Abort connecting transports as well as established connections.
      if (this._ws && this._ws.readyState <= WebSocket.OPEN) {
        this._ws.close()
      }
    }, delay)
    // Don't block process exit while waiting to close.
    if (typeof this._closeTimer.unref === 'function') this._closeTimer.unref()
  }

  /**
   * Waits for the WebSocket connection to be established.
   * @returns  Promise that resolves when connected
   * @throws   Error if connection times out, fails, or socket is closed
   */
  public async connect () : Promise<void> {
    // Reject if socket was explicitly closed.
    if (this._closed) throw new Error(`socket is closed for ${this.url}`)
    // Return early if already connected.
    if (this.is_ready) return
    // Create WebSocket on demand if not initialized or if closed/closing.
    if (!this._ws || this._ws.readyState >= WebSocket.CLOSING) {
      // A transport may enter CLOSING before emitting its close event.
      if (this._init) this._close()
      this._remove_listeners()
      this._ws = new WebSocket(this._url)
      this._attach_listeners()
    }
    // Wait for 'ready' event (multiple callers share the same wait).
    await wait_for_ready(this, {
      timeout     : this.config.msg_timeout,
      ready_event : 'ready',
      error_event : 'error',
      timeout_msg : `connection timeout for ${this.url}`,
      error_msg   : (err) => `connection failed for ${this.url}: ${err}`,
    })
  }

  /**
   * Publishes a signed event to the relay.
   * @param event  The signed event to publish
   * @returns      Promise that resolves with the publish response
   * @throws       Error if publish times out or is rejected by the relay
   */
  public async publish (event : SignedEvent) : Promise<PublishResponse> {
    await this.connect()
    const relay   = this.url
    const timeout = this.config.msg_timeout
    return new Promise((resolve, reject) => {
      // Guard against race between receipt and timeout.
      let settled = false
      // Handle receipt messages from the relay.
      const handler = (msg : RelayReceiptMessage) => {
        const [ _, event_id, ok, reason ] = msg
        // Ignore receipts for other events.
        if (event_id !== event.id) return
        if (settled) return
        settled = true
        clearTimeout(timer)
        this.off('receipt', handler)
        if (ok) resolve({ ok : true, event_id, relay })
        else reject({ ok : false, event_id, relay, reason })
      }
      // Timeout rejects if relay doesn't respond.
      const timer = setTimeout(() => {
        if (settled) return
        settled = true
        this.off('receipt', handler)
        reject(new Error(`publish timeout for ${this.url}`))
      }, timeout)
      // Start listening for receipt, then send event.
      this.on('receipt', handler)
      this.send([ 'EVENT', event ])
    })
  }

  /**
   * Queries the relay for events matching the filters.
   * Creates a temporary subscription that closes after receiving events.
   * @param filters   Event filter(s) to match
   * @param options   Optional options for the subscription
   * @returns         Promise that resolves with matching events
   */
  public async query (
    filters  : EventFilter | EventFilter[],
    options? : SubscriptionFilterOptions
  ) : Promise<SignedEvent[]> {
    // Ensure socket is connected before querying.
    await this.connect()
    // Create a new subscription.
    const sub = new NostrSubscription(filters, this, undefined, false)
    // Use try/finally to ensure cleanup on both success and error.
    try {
      const events = await sub.listen(options)
      return events
    } finally {
      // Always cancel the subscription to clean up resources.
      sub.cancel()
    }
  }

  /**
   * Sends a message to the relay via the message queue.
   * @param msg  The client message to send
   * @throws     Error if the message fails validation
   */
  public send (msg : ClientMessage) {
    if (!this._ws) {
      if (msg[0] === 'CLOSE') return
      throw new Error(`connect before sending to ${this.url}`)
    }
    if (this._closed || (this._ws && this._ws.readyState >= WebSocket.CLOSING)) {
      // Cancellation after remote close must not enqueue an undeliverable CLOSE.
      if (msg[0] === 'CLOSE') return
      throw new Error(`socket is closed for ${this.url}`)
    }
    // Validate the message.
    validate_client_message(msg)
    if (msg[0] === 'REQ') {
      this._requests.set(msg[1], msg.slice(2) as EventFilter[])
      this._filterCounts.set(msg[1], msg.slice(2).map(() => 0))
      this._historyComplete.delete(msg[1])
    }
    if (msg[0] === 'CLOSE') { this._requests.delete(msg[1]); this._filterCounts.delete(msg[1]); this._historyComplete.delete(msg[1]) }
    // Add the message to the queue.
    this._queue.push(msg)
  }

  /**
   * Creates a persistent subscription to the relay.
   * @param filters  Event filter(s) to subscribe to
   * @returns        Promise that resolves with the active subscription
   * @throws         Error if subscription times out
   */
  public subscribe (
    filters : EventFilter | EventFilter[]
  ) : NostrSubscription {
    // Create a new subscription.
    const sub = new NostrSubscription(filters, this)
    // Add the subscription to the subscriptions map.
    this._subs.set(sub.sub_id, sub)
    // Activate the subscription.
    return sub
  }
}
