import { Buff, Bytes } from '@cmdcode/buff'

import * as util from './lib/util.js'

export function ok (
  value    : unknown,
  message ?: string
) : asserts value {
  if (value === false) {
    throw new Error(message ?? 'Assertion failed!')
  }
}

export function is_hex (value : string) : asserts value is string {
  if (!util.is_hex(value)) {
    throw new TypeError(`Invalid hex: ${value}`)
  }
}

export function is_hash (value : string) : asserts value is string {
  if (!util.is_hash(value)) {
    throw new TypeError(`Invalid hash: ${value}`)
  }
}

export function size (input : Bytes, size : number) : void {
  const bytes = Buff.bytes(input)
  if (bytes.length !== size) {
    throw new Error(`Invalid input size: ${bytes.hex} !== ${size}`)
  }
}

export function exists <T> (
  value : T | null,
  msg  ?: string
  ) : asserts value is NonNullable<T> {
  if (!util.exists(value)) {
    throw new Error(msg ?? `Value is null or undefined!`)
  }
}

export function min_value (
  bytes : Bytes,
  min   : bigint
) : void {
  const val = Buff.bytes(bytes).big
  if (val < min) {
    throw new TypeError(`Bytes integer value is too low: ${val} < ${min}`)
  }
}
