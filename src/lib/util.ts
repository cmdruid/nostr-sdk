export function exists <T> (
  value ?: T | null
) : value is NonNullable<T> {
  if (typeof value === 'undefined' || value === null) {
    return false
  }
  return true
}

export function has_entry (
  label   : string,
  entries : string[][]
) : boolean {
  return entries.find(e => e[0] === label) !== undefined
}

export function get_entry (
  label   : string,
  entries : string[][]
) : string[] {
  const ent = entries.find(e => e[0] === label)
  if (ent === undefined) {
    throw new Error('label not found: ' + label)
  }
  return ent
}

export function is_hex (
  value : unknown
) : value is string {
  if (
    typeof value === 'string'            &&
    value.match(/[^a-fA-F0-9]/) === null &&
    value.length % 2 === 0
  ) { 
    return true
  }
  return false
}

export function is_hash (value : unknown) : value is string {
  if (is_hex(value) && value.length === 64) {
    return true
  }
  return false
}

export function is_stamp (value : unknown) : value is number {
  return (
    typeof value === 'number' &&
    value > 500_000_000       &&
    value <= Number.MAX_SAFE_INTEGER
  )
}

export function is_uint (
  value : unknown, 
  max_val = Number.MAX_SAFE_INTEGER
) : value is Number {
  if (typeof value === 'string') {
    value = Number(value)
  }
  if (typeof value !== 'number') {
    return false
  }
  return (
    typeof value === 'number' &&
    !isNaN(value)             && 
    value >= 0                && 
    value <= max_val          && 
    Math.floor(value) === value
  )
}

export function now () {
  return Math.floor(Date.now() / 1000)
}

export function sleep (ms ?: number) {
  return new Promise(res => setTimeout(res, ms ?? 1000))
}

export function stringify (content : any) : string {
  switch (typeof content) {
    case 'object':
      return (content !== null)
        ? JSON.stringify(content)
        : 'null'
    case 'string':
      return content
    case 'bigint':
      return String(content)
    case 'number':
      return String(content)
    case 'boolean':
      return String(content)
    case 'undefined':
      return 'undefined'
    default:
      throw new TypeError('Content type not supported: ' + typeof content)
  }
}
