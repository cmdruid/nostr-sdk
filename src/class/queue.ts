import { NostrSocket } from '@/class/socket.js'

import type { ClientMessage } from '@/types/index.js'

/**
 * Rate-limited message queue for sending messages to a relay.
 * Batches messages and sends them at a configurable interval to avoid flooding.
 */
export class MessageQueue {

  private readonly _socket : NostrSocket

  private _queue    : ClientMessage[] = []
  private _timer    : NodeJS.Timeout | undefined
  private _flushing : boolean = false
  private _generation : number = 0

  /**
   * Creates a new message queue.
   * @param socket  The NostrSocket to send messages through
   */
  constructor (socket : NostrSocket) {
    // Initialize the socket.
    this._socket = socket
  }

  /** Array of queued messages. */
  get entries () {
    return this._queue
  }

  /** Number of messages in the queue. */
  get size () {
    return this._queue.length
  }

  private _schedule () {
    // If already flushing or timer exists, skip.
    if (this._flushing || this._timer) return
    // If the queue is empty, return.
    if (this.size === 0) return
    // Mark as flushing and defer processing to allow batch accumulation.
    this._flushing = true
    // Use setImmediate (Node.js) or setTimeout(0) to defer to next tick.
    const defer = typeof setImmediate !== 'undefined' ? setImmediate : (fn: () => void) => setTimeout(fn, 0)
    const generation = this._generation
    defer(() => this._flush(generation))
  }

  private _flush (generation : number) {
    if (generation !== this._generation) return
    // Process a batch of messages.
    this._process()
    if (generation !== this._generation) return
    // If there are more messages, schedule the next batch.
    if (this.size > 0) {
      // Get the queue interval.
      const ival = this._socket.config.queue_ival
      // Set a new timeout for the next batch.
      this._timer = setTimeout(() => {
        this._timer = undefined
        this._flush(generation)
      }, ival)
      // Don't block process exit while waiting to flush.
      if (typeof this._timer.unref === 'function') this._timer.unref()
    } else {
      // Done flushing.
      this._flushing = false
    }
  }

  private _process () {
    // If the queue is empty, return.
    if (this.size === 0) return
    // Check WebSocket is open before sending.
    if (this._socket.ws.readyState !== WebSocket.OPEN) return
    // Get the batch limit.
    const limit = this._socket.config.queue_limit
    // Send up to limit messages.
    for (let i = 0; i < limit && this.size > 0; i++) {
      // Get the first message from the queue.
      const msg = this._queue.shift()
      // If the message is not defined, break.
      if (!msg) break
      // Send the message to the socket.
      try {
        this._socket._send(msg)
      } catch {
        // Re-queue the message on failure and stop.
        this._queue.unshift(msg)
        break
      }
    }
  }

  /** Clears all pending messages from the queue. */
  public clear () {
    this._generation += 1
    // Clear the queue.
    this._queue = []
    // Clear the timeout if it exists.
    clearTimeout(this._timer)
    this._timer = undefined
    this._flushing = false
  }

  /**
   * Adds a message to the queue for sending.
   * @param msg  The client message to queue
   */
  public push (msg : ClientMessage) : void {
    // Add the message to the queue.
    this._queue.push(msg)
    // Schedule the queue processing.
    this._schedule()
  }
}
