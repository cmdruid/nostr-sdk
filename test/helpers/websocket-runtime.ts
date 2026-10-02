import WebSocket from 'ws'

// Node20 has no native WebSocket. Keep the production runtime untouched.
if (typeof globalThis.WebSocket === 'undefined') globalThis.WebSocket = WebSocket as unknown as typeof globalThis.WebSocket
