import { EventFilter } from '@/types.js'

export function combine_filters (...filters : EventFilter[]) {
  const result = { ...filters[0] }

  for (const filter of filters.slice(1)) {
    Object.entries(filter).map(([ k, bv ]) => {
      if (bv !== undefined) {
        const av = result[k]
        if (av === undefined) {
          result[k] = bv
        } else if (Array.isArray(av) && Array.isArray(bv)) {
          result[k] = [ ...av, ...bv ]
        } else if (k === 'since') {
          result[k] = Math.max(av, bv)
        } else if (k === 'until') {
          result[k] = Math.min(av, bv)
        } else if (k === 'limit') {
          result[k] = Math.max(av, bv)
        }
      }
    })
  }

  return result
}