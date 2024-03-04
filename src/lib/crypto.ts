import { Buff, Bytes } from '@cmdcode/buff'
import { SignerAPI }   from '@cmdcode/signer'
import { SignedEvent } from '@/types.js'

import {
  encrypt_cbc,
  decrypt_cbc
} from '@cmdcode/crypto-tools/cipher'

import { get_entry, has_entry } from './util.js'

import * as assert from '@/assert.js'

export function encrypt_content (
  content : string,
  secret  : Bytes
) {
  const bytes   = Buff.str(content) 
  const vector  = Buff.random(16)
  const encoded = encrypt_cbc(bytes, secret, vector)
  return encoded.b64url + '?iv=' + vector.b64url
}

export function decrypt_content (
  content : string, 
  secret  : Bytes
) {
  const [ enc, iv ] = content.split('?iv=')
  const data   = Buff.b64url(enc)
  const vector = Buff.b64url(iv)
  return decrypt_cbc(data, secret, vector).str
}

export function encrypt_store_key (
  secret : string,
  signer : SignerAPI
) {
  const hash = Buff.hex(secret).digest
  const hmac = signer.hmac('256', hash)
  const enc  = encrypt_content(secret, hmac)
  const id   = hmac.digest.hex
  return [ id, enc ]
}

export function check_store_key (
  event  : SignedEvent,
  signer : SignerAPI
) {
  if (
    !has_entry('d', event.tags) || 
    !has_entry('rec', event.tags)
  ) {
    return false
  }
  const hash = get_entry('d', event.tags)[1]
  const rid  = get_entry('rec', event.tags)[1]
  assert.ok(typeof hash === 'string')
  assert.ok(typeof rid  === 'string')
  const hmac = signer.hmac('256', hash)
  const id   = hmac.digest.hex
  return (rid === id)
}

export function decrypt_store_key (
  event   : SignedEvent,
  signer  : SignerAPI
) {
  const enc = get_entry('rec', event.tags)[2]
  const rid = get_entry('d', event.tags)[1]
  assert.ok(typeof enc === 'string')
  assert.ok(typeof rid === 'string')
  const hmac = signer.hmac('256', rid)
  return decrypt_content(enc, hmac)
}
