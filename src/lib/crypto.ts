import { Buff, Bytes } from '@cmdcode/buff'

import {
  encrypt_cbc,
  decrypt_cbc
} from '@cmdcode/crypto-tools/cipher'

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
