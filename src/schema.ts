import { z } from 'zod'

const num   = z.number().max(Number.MAX_SAFE_INTEGER),
      str   = z.string(),
      stamp = z.number().min(500_000_000)

const hex = z.string()
  .regex(/^[0-9a-fA-F]*$/)
  .refine(e => e.length % 2 === 0)

const label  = z.string().regex(/^[0-9a-zA-Z_-]{2,64}$/)
const hash   = hex.refine((e) => e.length === 64)
const pubkey = hex.refine((e) => e.length === 64 || e.length === 66)
const sig    = hex.refine((e) => e.length === 128)
const tags   = str.array()

const unsigned_note = z.object({
  content    : str,
  created_at : stamp,
  kind       : num,
  pubkey     : hash,
  tags       : tags.array()
})

const signed_note = unsigned_note.extend({
  id  : hash,
  sig : sig,
})

export {
  hash,
  hex,
  label,
  unsigned_note,
  signed_note,
  num,
  pubkey,
  sig,
  str,
  tags,
  stamp
}
