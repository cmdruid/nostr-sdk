import '#/helpers/websocket-runtime.js'
import tape from 'tape'

// Crypto tests
import ecc_tests         from './crypto/ecc.test.js'
import hash_tests        from './crypto/hash.test.js'
import cipher_tests      from './crypto/cipher.test.js'
import encode_tests      from './crypto/encode.test.js'
import util_crypto_tests from './crypto/util.test.js'

// Lib tests
import event_tests    from './lib/event.test.js'
import filter_tests   from './lib/filter.test.js'
import parse_tests    from './lib/parse.test.js'
import validate_tests from './lib/validate.test.js'
import util_tests     from './lib/util.test.js'
import assert_tests   from './lib/assert.test.js'
import encrypt_tests  from './lib/encrypt.test.js'
import rpc_tests      from './lib/rpc.test.js'

// Class tests
import emitter_tests from './class/emitter.test.js'
import cache_tests   from './class/cache.test.js'
import queue_tests   from './class/queue.test.js'
import socket_tests  from './class/socket.test.js'
import client_tests  from './class/client.test.js'
import runtime_tests from './class/runtime.test.js'
import lifecycle_tests from './class/lifecycle.test.js'

tape('Crypto Unit Tests', t => {
  ecc_tests(t)
  hash_tests(t)
  cipher_tests(t)
  encode_tests(t)
  util_crypto_tests(t)
  t.end()
})

tape('Lib Unit Tests', t => {
  event_tests(t)
  filter_tests(t)
  parse_tests(t)
  validate_tests(t)
  util_tests(t)
  assert_tests(t)
  encrypt_tests(t)
  rpc_tests(t)
  t.end()
})

tape('Class Unit Tests', t => {
  emitter_tests(t)
  cache_tests(t)
  queue_tests(t)
  socket_tests(t)
  client_tests(t)
  runtime_tests(t)
  lifecycle_tests(t)
  t.end()
})
