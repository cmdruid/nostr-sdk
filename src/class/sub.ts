import { KeyCache }     from '@/class/cache.js'
import { EventEmitter } from '@/class/emitter.js'
import { NostrClient }  from '@/class/client.js'
import { NostrSocket }  from '@/class/socket.js'

import {
  assert_ok,
  generate_label,
  match_any_filter,
  now,
  wait_for_ready
} from '@/lib/index.js'

import type {
  EventFilter,
  NostrSocketConfig,
  NostrSubscriptionEvent,
  RelayClosedMessage,
  RelayEventMessage,
  RelayMessage,
  SignedEvent,
  SubscriptionFilterOptions,
  SubscriptionManagerEvent,
  SubscriptionState
} from '@/types/index.js'

const SUB_DEFAULTS : SubscriptionState = {
  active  : false,
  count   : 0,
  eose    : false,
  retries : 0,
  since   : 0
}

/**
 * Subscription to a single Nostr relay.
 * Handles REQ/CLOSE protocol, automatic resubscription, and event emission.
 */
export class NostrSubscription extends EventEmitter <NostrSubscriptionEvent> {

  private readonly _config  : NostrSocketConfig
  private readonly _filters : EventFilter[]
  private readonly _sub_id  : string
  private readonly _socket  : NostrSocket
  public readonly persistent : boolean

  /** Bound handler reference for proper cleanup. */
  private readonly _handler : (msg: RelayMessage) => void

  private _state     : SubscriptionState = { ...SUB_DEFAULTS, since: now() }
  private _timer     : NodeJS.Timeout | undefined
  private _cancelled : boolean = false
  private _started : boolean = false
  private _paused : boolean = false

  /**
   * Creates a new subscription to a relay.
   * @param filters  Event filter(s) for the subscription
   * @param socket   The NostrSocket to subscribe through
   * @param sub_id   Optional subscription ID (auto-generated if not provided)
   */
  constructor (
    filters : EventFilter | EventFilter[],
    socket  : NostrSocket,
    sub_id? : string,
    persistent = true
  ) {
    // Initialize the class.
    super()
    // Initialize the configuration.
    this._config  = socket.config
    // Initialize the filters.
    this._filters = Array.isArray(filters) ? filters : [ filters ]
    // Initialize the subscription ID.
    this._sub_id  = sub_id ?? generate_label()
    // Initialize the socket.
    this._socket  = socket
    this.persistent = persistent
    // Create bound handler reference for cleanup.
    this._handler = (msg: RelayMessage) => this._on_message(msg)
    // Subscribe to the message event.
    this._socket.on('message', this._handler)
    this._socket.subs.set(this.sub_id, this)
  }

  /** Subscription configuration inherited from the socket. */
  public get config () {
    return this._config
  }

  /** Event filters for this subscription. */
  public get filters () {
    return this._filters
  }

  /** Unique subscription ID. */
  public get sub_id () {
    return this._sub_id
  }

  /** Whether the subscription is active (has received EOSE). */
  public get is_active () {
    return this._state.active
  }

  /** The socket this subscription is connected through. */
  public get socket () {
    return this._socket
  }

  /** Current subscription state including event count and retry info. */
  public get state () {
    return this._state
  }

  private _cancel (reason : string) {
    if (this._cancelled) return
    // Set the cancelled flag to prevent timer race conditions.
    this._cancelled = true
    if (this.socket.subs.get(this.sub_id) === this) this.socket.subs.delete(this.sub_id)
    // Reset the subscription state.
    this._state = { ...SUB_DEFAULTS, since: now() }
    // Clear the keep-alive timer.
    clearTimeout(this._timer)
    // Unsubscribe from the socket message event.
    this._socket.off('message', this._handler)
    // Emit the closed event.
    this.emit('cancel', reason)
  }

  private _on_cancel (msg : RelayClosedMessage) {
    // CLOSED is terminal for this REQ, even before its first EOSE.
    this._cancel(msg[2])
  }

  /** Suspend on transport loss without discarding the persistent listener. */
  public _needs_reconnect () { return this._started && !this._cancelled }

  public _pause () {
    if (!this._started) return
    clearTimeout(this._timer)
    this._paused = true
    this._state.active = false
    this._state.eose = false
    this.emit('cancel', 'relay disconnected')
  }

  /** Resume only subscriptions that had already requested events. */
  public _resume () {
    if (!this._paused || !this._started || this._cancelled) return
    this._paused = false
    this._subscribe()
    this._keep_alive()
  }

  private _on_eose () {
    // Set the eose state to true.
    this._state.eose = true
    // Emit the eose event.
    this.emit('eose')
    if (this._cancelled) return
    // Update the retry count.
    this._state.retries = 0
    // Update the keep-alive timer.
    this._keep_alive()
    // If the subscription is not active,
    if (!this._state.active) {
      // Set the active state to true.
      this._state.active = true
      // Emit the active event.
      this.emit('active')
    }
  }

  private _on_event (msg : RelayEventMessage) {
    // A relay response must satisfy this subscription's filters locally.
    if (!match_any_filter(msg[2], this._filters)) return
    // Update the event count.
    this._state.count += 1
    // Update the keep-alive timer.
    this._keep_alive()
    // Emit the event.
    this.emit('event', msg[2])
  }

  private _on_message (msg : RelayMessage) {
    // Unpack the message.
    const [ type, sub_id ] = msg
    // If the subscription ID does not match, return.
    if (sub_id !== this.sub_id) return
    // Update the since timestamp.
    this._state.since = now()
    // Handle the message based on the type.
    switch (type) {
      case 'CLOSED' : this._on_cancel(msg) ;break
      case 'EOSE'   : this._on_eose()      ;break
      case 'EVENT'  : this._on_event(msg)  ;break
    }
  }

  private _keep_alive () {
    if (this._cancelled || this._paused) return
    // Define the subscription timeout.
    const timeout = this.config.sub_timeout
    // If the keep-alive timer exists, clear it.
    clearTimeout(this._timer)
    // Set a new timer to resubscribe, guarded against race condition.
    this._timer = setTimeout(() => {
      if (this._cancelled || this._paused) return
      try {
        this._subscribe()
      } catch (error) {
        // A transport can enter CLOSING before its close event arrives.
        this._pause()
        this.socket.emit('error', String(error))
      }
    }, timeout)
    // Prevent timer from blocking process exit in Node.js.
    if (typeof this._timer.unref === 'function') this._timer.unref()
  }

  private _subscribe () {
    if (this._cancelled || this._paused) return
    this._started = true
    // Send a subscription request to the relay.
    this.socket.send([ 'REQ', this.sub_id, ...this.filters ])
  }

  /**
   * Listens for events until the specified mode triggers or timeout occurs.
   * 
   * Mode determines when to stop collecting:
   *   'eose'    - stop when relay signals end of stored events (default)
   *   'event'   - stop after the first verified event
   *   'timeout' - stop only when timeout expires
   * 
   * @param options  Optional options (mode: 'eose' | 'event' | 'timeout', duration)
   * @returns        Promise that resolves with collected events
   */
  public listen (options : SubscriptionFilterOptions = {}) : Promise<SignedEvent[]> {
    // Define the mode and timeout.
    const mode    = options.mode     ?? 'eose'
    const timeout = options.duration ?? this.config.msg_timeout
    // Create a list to store the events.
    const results : SignedEvent[] = []
    // Send REQ message if subscription hasn't received EOSE yet.
    if (!this.is_active) this._subscribe()
    if (this._cancelled) return Promise.resolve([])
    return new Promise((resolve, reject) => {
      let settled = false
      const handler = (event : SignedEvent) => { results.push(event) }
      const cleanup = () => {
        clearTimeout(timer)
        this.off('event', handler)
        this.off('cancel', cancelled)
        if (mode !== 'timeout') this.off(mode, finish)
      }
      const finish = () => {
        if (settled) return
        settled = true
        cleanup()
        resolve(results)
      }
      const cancelled = (reason : string) => {
        if (settled) return
        settled = true
        cleanup()
        reject(new Error(`subscription cancelled before completion: ${reason}`))
      }
      const timer = setTimeout(() => {
        if (this.socket.has_pending_messages(this.sub_id)) cancelled('verification backlog at timeout')
        else finish()
      }, timeout)
      this.on('event', handler)
      this.once('cancel', cancelled)
      if (mode !== 'timeout') this.once(mode, finish)
    })
  }

  /** Reject pending reads without enqueuing a CLOSE on a lost transport. */
  public _fail (reason : string) { this._cancel(reason) }

  /**
   * Activates the subscription and waits for EOSE.
   * @returns  Promise that resolves with this subscription when active
   * @throws   Error if subscription times out or is closed by the relay
   */
  public async activate () : Promise<NostrSubscription> {
    // If the subscription is already active, return the subscription.
    if (this.state.active) return this
    // Reset the cancelled flag when activating.
    this._cancelled = false
    this._socket.off('message', this._handler)
    this._socket.on('message', this._handler)
    this._socket.subs.set(this.sub_id, this)
    // Send the subscription request.
    this._subscribe()
    // Wait for EOSE or cancel.
    await wait_for_ready(this, {
      timeout     : this.config.msg_timeout,
      ready_event : 'eose',
      error_event : 'cancel',
      timeout_msg : `subscription timeout for ${this.socket.url}`,
      error_msg   : (reason) => `subscription closed by ${this.socket.url}: ${reason}`,
    })
    return this
  }

  /** Closes the subscription and sends CLOSE message to the relay. */
  public cancel () {
    // Close the subscription.
    this._cancel('unsubscribed')
    // Send a close message to the relay.
    this.socket.send([ 'CLOSE', this.sub_id ])
  }
}

/**
 * Manages subscriptions across multiple relays with event deduplication.
 * Aggregates events from all subscriptions and emits them through a single interface.
 */
export class SubscriptionManager extends EventEmitter <SubscriptionManagerEvent> {

  private readonly _cache  : KeyCache
  private readonly _client : NostrClient
  private readonly _config : NostrSocketConfig
  private readonly _subs   : Map<string, NostrSubscription>

  /** Whether at least one subscription is active. */
  private _active : boolean = false

  /**
   * Creates a new subscription manager.
   * @param subscriptions  Array of NostrSubscription instances to manage
   * @param cache_size     Size of the deduplication cache (default: 1000)
   * @throws Error         If subscriptions array is empty
   */
  constructor (
    client        : NostrClient,
    subscriptions : NostrSubscription[],
    cache_size    : number = 1000
  ) {
    // Assert that the subscriptions array is not empty.
    assert_ok(subscriptions.length > 0, 'subscriptions are required')
    // Initialize the class.
    super()
    // Initialize the cache.
    this._cache  = new KeyCache(cache_size)
    // Initialize the client.
    this._client = client
    // Initialize the configuration.
    this._config = subscriptions[0].socket.config
    // Initialize the subscriptions map.
    this._subs   = new Map(subscriptions.map(sub => [ sub.socket.url, sub ]))
    // Register handlers for each subscription.
    this._subs.forEach(sub => {
      sub.on('cancel', (reason?: string)    => this._on_cancel(sub, reason))
      sub.on('eose',   ()                   => this._on_eose(sub))
      sub.on('event',  (event: SignedEvent) => this._on_event(event))
    })
  }

  /** Event deduplication cache. */
  public get cache () {
    return this._cache
  }

  /** Client that the subscriptions are connected to. */
  public get client () {
    return this._client
  }

  /** Configuration inherited from the first subscription. */
  public get config () {
    return this._config
  }

  /** Whether at least one subscription is active. */
  public get is_active () {
    return this._active
  }

  /** Array of managed subscriptions. */
  public get subs () {
    return Array.from(this._subs.values())
  }

  private _on_cancel (sub : NostrSubscription, reason? : string) {
    // Set the active state to false.
    this._active = this.subs.some(sub => sub.state.active)
    // If the subscription is not active, emit the cancel event.
    this.emit('cancel', sub, reason ?? 'unknown')
  }

  private _on_eose (sub : NostrSubscription) {
    // Emit the eose event.
    this.emit('eose', sub)
    // If the subscription is not active,
    if (!this._active) {
      // Set the active state to true.
      this._active = true
      // Emit the active event.
      this.emit('active')
    }
  }

  private _on_event (event : SignedEvent) {
    // If the event is already in the cache, return.
    if (this.cache.has(event.id)) return
    // Add the event to the cache.
    this._cache.add(event.id)
    // Emit the event.
    this.emit('event', event)
    // Pass the event to the client.
    this.client.emit('event', event)
  }

  /**
   * Gets a subscription by relay URL.
   * @param id  The relay URL
   * @returns   The subscription or undefined if not found
   */
  public get (id : string) : NostrSubscription | undefined {
    return this._subs.get(id)
  }

  /**
   * Activates all subscriptions and waits for the first EOSE.
   * @returns  Promise that resolves with this manager when first subscription is active
   * @throws   Error if all subscriptions timeout
   */
  public async activate () : Promise<SubscriptionManager> {
    // Activate all subs (catch errors - individual failures expected).
    this.subs.forEach(sub => { sub.activate().catch(() => {}) })
    // Wait for first EOSE from any subscription.
    await wait_for_ready(this, {
      timeout     : this.config.msg_timeout,
      ready_event : 'eose',
      error_event : undefined,
      timeout_msg : 'subscription timeout',
      error_msg   : () => '',
    })
    return this
  }

  /** Closes all subscriptions and clears the manager state. */
  public cancel () {
    // Clear listeners and cancel all subscriptions.
    this._subs.forEach(sub => {
      sub.clear_listeners()
      sub.cancel()
    })
    // Clear the subscriptions map.
    this._subs.clear()
    // Set the active state to false.
    this._active = false
  }
}
