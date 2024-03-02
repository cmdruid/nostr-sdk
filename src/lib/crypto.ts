import { SignedEvent } from '@/types.js'
import { Buff, Bytes } from '@cmdcode/buff'

import {
  encrypt_cbc,
  decrypt_cbc
} from '@cmdcode/crypto-tools/cipher'
import { SignerAPI } from '@cmdcode/signer'
import { get_entry, has_entry } from './util.js'

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
  content : string,
  secret  : string,
  signer  : SignerAPI
) {
  const hash = Buff.str(content).digest
  const hmac = signer.hmac('256', hash)
  const enc  = encrypt_content(secret, hmac)
  const id   = hmac.digest
  return Buff.join([ id, enc ])
}

export function check_store_key (
  event   : SignedEvent,
  signer  : SignerAPI
) {
  if (!has_entry('rec', event.tags)) return false
  const tags = get_entry('rec', event.tags)
  const hash = Buff.str(event.content).digest
  const hmac = signer.hmac('256', hash)
  const id   = hmac.digest.hex
  return (tags[1] === id)
}

export function decrypt_store_key (
  event   : SignedEvent,
  signer  : SignerAPI
) {
  const tags  = get_entry('rec', event.tags)
  const hash  = Buff.str(event.content).digest
  const hmac  = signer.hmac('256', hash)
  return decrypt_content(tags[2], hmac)
}
