import { EventEmitter } from '@/class/emitter.js'

import {
  NostrSubscription,
  SubscriptionManager
} from '@/class/sub.js'

import {
  NostrSocket,
  SOCKET_CONFIG
} from '@/class/socket.js'

import type {
  EventFilter,
  SignedEvent,
  PublishResponse,
  NostrClientConfig,
  SubscriptionFilterOptions
} from '@/types/index.js'

import {
  generate_label,
  promise_any_with_context
} from '@/lib/util.js'

/** Default configuration for NostrClient instances. */
export const CLIENT_CONFIG : () => NostrClientConfig = () => {
    return {
    ...SOCKET_CONFIG,
      cache_size : 500
    }
}

/**
 * Multi-relay Nostr client that aggregates connections to multiple relays.
 * Provides unified interface for publishing, querying, and subscribing across relays.
 * @emits closed  When a socket connection is closed
 * @emits ready   When a socket connection is established
 * @emits notice  When a NOTICE message is received from a relay
 * @emits error   When a socket error occurs
 */
export class NostrClient extends EventEmitter <{
  closed : [ NostrSocket ],
  event  : [ SignedEvent ],
  ready  : [ NostrSocket ],
  notice : [ string, NostrSocket ],
  error  : [ string, NostrSocket ]
}> {
  private readonly _config  : NostrClientConfig
  private readonly _sockets : Map<string, NostrSocket> = new Map()
  private readonly _subs    : Map<string, SubscriptionManager> = new Map()

  private _init : boolean = false

  /**
   * Creates a new NostrClient connected to multiple relays.
   * @param relays   Array of relay URLs or existing NostrSocket instances
   * @param options  Optional configuration overrides
   * @throws Error   If relays array is empty
   */
  constructor (
    relays  : (string | NostrSocket)[],
    options : Partial<NostrClientConfig> = {}
  ) {
    // Initialize the class.
    super()
    // Validate that at least one relay is provided.
    if (relays.length === 0) {
      throw new Error('at least one relay is required')
    }
    // Initialize the configuration.
    this._config  = { ...CLIENT_CONFIG(), ...options }
    // For each relay.
    for (const relay of relays) {
      // Initialize or register the socket.
      this._add_socket(relay)
    }
  }

  /**
   * Creates and registers a socket for a relay.
   * @param relay  The relay URL or existing NostrSocket instance
   */
  private _add_socket (relay : string | NostrSocket) : NostrSocket {
    // If already a NostrSocket, use it directly.
    const socket = typeof relay === 'string'
      ? new NostrSocket(relay, this.config)
      : relay
    // Listen for ready event to set _init flag.
    socket.on('ready', () => {
      if (!this._init) this._init = true
    })
    // Listen for closed event and forward it.
    socket.on('closed', () => {
      this.emit('closed', socket)
      // Check if all sockets are closed.
      const all_closed = this.sockets.every(s => !s.is_ready)
      if (all_closed) this._init = false
    })
    // Add the socket to the sockets map.
    this._sockets.set(socket.url, socket)
    // Return the socket.
    return socket
  }

  /** Current client configuration. */
  get config () {
    return this._config
  }

  /** Whether any relay connection is ready. */
  get is_ready () {
    return this._init
  }

  /** Array of relay socket connections. */
  get sockets () {
    return Array.from(this._sockets.values())
  }

  /** Map of subscription managers by subscription ID. */
  get subs () {
    return this._subs
  }

  /** Closes all relay connections and cancels all subscriptions. */
  public close () {
    // Cancel all subscription managers first.
    this._subs.forEach(sub => void sub.cancel())
    this._subs.clear()
    // Then close all sockets.
    this.sockets.forEach(socket => void socket.close())
  }

  /**
   * Connects to all relays, resolving when the first one connects.
   * @param relays   Optional additional relay URLs to connect
   * @returns        Promise that resolves when at least one relay connects
   */
  public async connect (relays : string[] = []) : Promise<void> {
    // For each relay URL provided.
    for (const url of relays) {
      // Initialize a new socket for the relay.
      this._add_socket(url)
    }
    // Create a set of receipts.
    const promises = this.sockets.map(socket => socket.connect())
    // Return a promise that resolves when the first receipt is received.
    return promise_any_with_context(promises, 'connect', this.sockets)
  }

  /**
   * Connects to all relays, resolving when all are connected.
   * @returns  Promise that resolves when all relays connect
   * @throws   Error if any relay fails to connect
   */
  public async connect_all () : Promise<void> {
    // Create connection promises for all sockets.
    const promises = this.sockets.map(socket => socket.connect())
    // Wait for all connections to complete.
    await Promise.all(promises)
  }

  /**
   * Publishes an event to all relays, resolving on first success.
   * @param event  The signed event to publish
   * @returns      Promise that resolves with the first successful response
   */
  public async publish (event : SignedEvent) : Promise<PublishResponse> {
    // Create a set of promises.
    const promises = this.sockets.map(socket => socket.publish(event))
    // Return a promise that resolves when the first receipt is received.
    return promise_any_with_context(promises, 'publish', this.sockets)
  }

  /**
   * Queries all relays for events, resolving on first response.
   * @param filters   Event filter(s) to match
   * @param options   Optional options for the subscription
   * @returns         Promise that resolves with the first relay's matching events
   */
  public async query (
    filters   : EventFilter | EventFilter[],
    options?  : SubscriptionFilterOptions
  ) : Promise<SignedEvent[]> {
    // Create a set of queries.
    const promises = this.sockets.map(socket => socket.query(filters, options))
    // Return a promise that resolves when the first query is completed.
    return promise_any_with_context(promises, 'query', this.sockets)
  }

  /**
   * Creates a subscription across all relays with event deduplication.
   * @param filter  Event filter(s) to subscribe to
   * @param sub_id  Optional subscription ID (auto-generated if not provided)
   * @returns       Promise that resolves with the subscription manager
   * @throws        Error if subscription ID already exists or times out on all relays
   */
  public subscribe (
    filter : EventFilter | EventFilter[],
    sub_id : string = generate_label()
  ) : SubscriptionManager {
    // Check if subscription ID already exists.
    const existing = this._subs.get(sub_id)
    if (existing) {
      throw new Error(`subscription already exists: ${sub_id}`)
    }
    // Create a set of subscriptions.
    const subs    = this.sockets.map(socket => new NostrSubscription(filter, socket, sub_id))
    // Create a new subscription manager.
    const manager = new SubscriptionManager(this, subs, this.config.cache_size)
    // Add the subscription manager to the subscriptions map.
    this._subs.set(sub_id, manager)
    // Return a promise that resolves when the first subscription is active.
    return manager
  }
}
