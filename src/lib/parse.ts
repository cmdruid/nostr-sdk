import * as schema from '@/schema.js'

import {
  UnsignedEvent,
  SignedEvent
} from '@/types.js'

export async function parse_unsigned_note (
  note : unknown
) : Promise<UnsignedEvent | null> {
  const parser = schema.unsigned_note
  const parsed = await parser.spa(note)
  return (parsed.success)
    ? parsed.data
    : null
}

export async function parse_signed_note (
  note : unknown
) : Promise<SignedEvent | null> {
  const parser = schema.signed_note
  const parsed = await parser.spa(note)
  return (parsed.success)
    ? parsed.data
    : null
}
