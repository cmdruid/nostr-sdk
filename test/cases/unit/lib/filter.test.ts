import { Test } from 'tape'

import {
  match_filter,
  match_any_filter,
  match_tags,
  get_tag_filters,
  get_event_cache_key,
  process_filters,
  is_kind_regular,
  is_kind_replace,
  is_kind_ephemeral,
  is_kind_address
} from '@/lib/filter.js'

import { create_event, sign_event } from '@/lib/event.js'
import { gen_seckey, get_pubkey }   from '@/crypto/ecc.js'

function createSignedEvent (opts: { kind?: number, pubkey?: string, tags?: string[][] } = {}) {
  const seckey = gen_seckey()
  const pubkey = opts.pubkey ?? get_pubkey(seckey)
  const event  = create_event({
    content    : 'test',
    kind       : opts.kind ?? 1,
    pubkey,
    tags       : opts.tags ?? [],
    created_at : 1000000
  })
  return sign_event(event, seckey)
}

export default function filter_tests (t: Test) {
  t.test('match_filter', st => {
    st.test('matches by id', t => {
      const event = createSignedEvent()
      t.ok(match_filter(event, { ids: [event.id] }), 'matches when id in list')
      t.notOk(match_filter(event, { ids: ['nonexistent'] }), 'no match for wrong id')
      t.end()
    })

    st.test('matches by author', t => {
      const seckey = gen_seckey()
      const pubkey = get_pubkey(seckey)
      const event  = createSignedEvent({ pubkey })

      t.ok(match_filter(event, { authors: [pubkey] }), 'matches when author in list')
      t.notOk(match_filter(event, { authors: ['other'] }), 'no match for wrong author')
      t.end()
    })

    st.test('matches by kind', t => {
      const event = createSignedEvent({ kind: 1 })
      t.ok(match_filter(event, { kinds: [1] }), 'matches when kind in list')
      t.ok(match_filter(event, { kinds: [1, 2, 3] }), 'matches when kind in multi-kind list')
      t.notOk(match_filter(event, { kinds: [2] }), 'no match for wrong kind')
      t.end()
    })

    st.test('matches by tag filter', t => {
      const event = createSignedEvent({ tags: [['e', 'event123'], ['p', 'pubkey456']] })

      t.ok(match_filter(event, { '#e': ['event123'] }), 'matches e tag')
      t.ok(match_filter(event, { '#p': ['pubkey456'] }), 'matches p tag')
      t.notOk(match_filter(event, { '#e': ['wrong'] }), 'no match for wrong tag value')
      t.end()
    })

    st.test('filters by since timestamp', t => {
      const event = createSignedEvent()
      // Event created_at is 1000000

      t.ok(match_filter(event, { kinds: [1], since: 999999 }), 'matches when after since')
      t.ok(match_filter(event, { kinds: [1], since: 1000000 }), 'matches when equal to since')
      t.notOk(match_filter(event, { kinds: [1], since: 1000001 }), 'no match when before since')
      t.end()
    })

    st.test('filters by until timestamp', t => {
      const event = createSignedEvent()
      // Event created_at is 1000000

      t.ok(match_filter(event, { kinds: [1], until: 1000001 }), 'matches when before until')
      t.ok(match_filter(event, { kinds: [1], until: 1000000 }), 'matches when equal to until')
      t.notOk(match_filter(event, { kinds: [1], until: 999999 }), 'no match when after until')
      t.end()
    })

    st.test('empty filter behavior', t => {
      const event = createSignedEvent()
      t.ok(match_filter(event, {}), 'empty filter is a wildcard')
      t.end()
    })

    st.test('AND logic: kind + tag filter (both match)', t => {
      const event = createSignedEvent({ kind: 1, tags: [['e', 'event123']] })
      t.ok(match_filter(event, { kinds: [1], '#e': ['event123'] }), 'matches when both conditions satisfied')
      t.end()
    })

    st.test('AND logic: kind + tag filter (kind matches, tag does not)', t => {
      const event = createSignedEvent({ kind: 1, tags: [] })
      t.notOk(match_filter(event, { kinds: [1], '#e': ['event123'] }), 'fails when tag filter not satisfied')
      t.end()
    })

    st.test('AND logic: kind + tag filter (tag matches, kind does not)', t => {
      const event = createSignedEvent({ kind: 2, tags: [['e', 'event123']] })
      t.notOk(match_filter(event, { kinds: [1], '#e': ['event123'] }), 'fails when kind filter not satisfied')
      t.end()
    })

    st.test('AND logic: author + kind + tag (all match)', t => {
      const seckey = gen_seckey()
      const pubkey = get_pubkey(seckey)
      const event  = createSignedEvent({ kind: 1, pubkey, tags: [['p', 'target']] })

      t.ok(match_filter(event, { authors: [pubkey], kinds: [1], '#p': ['target'] }), 'matches when all conditions satisfied')
      t.end()
    })

    st.test('AND logic: author + kind + tag (tag fails)', t => {
      const seckey = gen_seckey()
      const pubkey = get_pubkey(seckey)
      const event  = createSignedEvent({ kind: 1, pubkey, tags: [] })

      t.notOk(match_filter(event, { authors: [pubkey], kinds: [1], '#p': ['target'] }), 'fails when tag not present')
      t.end()
    })

    st.test('multiple values in kind filter (OR within kinds)', t => {
      const event = createSignedEvent({ kind: 2 })

      t.ok(match_filter(event, { kinds: [1, 2, 3] }), 'matches when kind in list')
      t.notOk(match_filter(event, { kinds: [1, 3, 4] }), 'fails when kind not in list')
      t.end()
    })

    st.test('multiple values in tag filter (OR within tag values)', t => {
      const event = createSignedEvent({ kind: 1, tags: [['e', 'xyz']] })

      t.ok(match_filter(event, { kinds: [1], '#e': ['abc', 'xyz'] }), 'matches when one of tag values present')
      t.notOk(match_filter(event, { kinds: [1], '#e': ['abc', 'def'] }), 'fails when none of tag values present')
      t.end()
    })

    st.test('multiple tag types (AND across tag types)', t => {
      const event = createSignedEvent({ kind: 1, tags: [['e', 'event1'], ['p', 'pubkey1']] })

      t.ok(match_filter(event, { kinds: [1], '#e': ['event1'], '#p': ['pubkey1'] }), 'matches when all tag types present')
      t.notOk(match_filter(event, { kinds: [1], '#e': ['event1'], '#p': ['other'] }), 'fails when one tag type value wrong')
      t.end()
    })

    st.test('multiple tag types (one tag type missing)', t => {
      const event = createSignedEvent({ kind: 1, tags: [['e', 'event1']] })

      t.notOk(match_filter(event, { kinds: [1], '#e': ['event1'], '#p': ['pubkey1'] }), 'fails when p tag missing')
      t.end()
    })

    st.test('custom single-letter tag (h tag)', t => {
      const event = createSignedEvent({ kind: 1, tags: [['h', 'somehash']] })

      t.ok(match_filter(event, { kinds: [1], '#h': ['somehash'] }), 'matches custom h tag')
      t.notOk(match_filter(event, { kinds: [1], '#h': ['wronghash'] }), 'fails for wrong h tag value')
      t.end()
    })

    st.test('tag with extra parameters', t => {
      const event = createSignedEvent({ kind: 1, tags: [['e', 'eventid', 'relay', 'pubkey']] })

      t.ok(match_filter(event, { '#e': ['eventid'] }), 'matches ignoring extra params')
      t.end()
    })

    st.test('time constraints with combined filters', t => {
      const event = createSignedEvent({ kind: 1 })
      // Event created_at is 1000000

      t.ok(match_filter(event, { kinds: [1], since: 999999, until: 1000001 }), 'matches when in time range')
      t.notOk(match_filter(event, { kinds: [1], since: 1000001, until: 1000002 }), 'fails when before time range')
      t.notOk(match_filter(event, { kinds: [1], since: 999998, until: 999999 }), 'fails when after time range')
      t.end()
    })

    st.test('filter with only time constraints', t => {
      const event = createSignedEvent()

      t.ok(match_filter(event, { since: 999999, until: 1000001 }), 'matches within time bounds')
      t.end()
    })

    st.test('filter with empty arrays (no positive criteria)', t => {
      const event = createSignedEvent()

      for (const filter of [{ kinds: [] }, { authors: [] }, { ids: [] }, { '#e': [] }]) {
        t.notOk(match_filter(event, filter), 'fails with an explicitly empty constraint')
      }
      t.end()
    })

    st.end()
  })

  t.test('match_any_filter', st => {
    st.test('returns true if any filter matches', t => {
      const event = createSignedEvent({ kind: 1 })
      const filters = [
        { kinds: [2] },
        { kinds: [1] },
        { kinds: [3] }
      ]

      t.ok(match_any_filter(event, filters), 'matches when one filter matches')
      t.end()
    })

    st.test('returns false if no filter matches', t => {
      const event = createSignedEvent({ kind: 1 })
      const filters = [
        { kinds: [2] },
        { kinds: [3] }
      ]

      t.notOk(match_any_filter(event, filters), 'no match when no filter matches')
      t.end()
    })

    st.test('returns false for empty filters array', t => {
      const event = createSignedEvent()
      t.notOk(match_any_filter(event, []), 'no match for empty filters')
      t.end()
    })

    st.test('OR across filters with different conditions', t => {
      const event = createSignedEvent({ kind: 1, tags: [['e', 'event1']] })

      const filters = [
        { kinds: [2] },                    // doesn't match
        { '#e': ['event1'] }               // matches
      ]
      t.ok(match_any_filter(event, filters), 'matches second filter')
      t.end()
    })

    st.test('each filter uses AND internally', t => {
      const event = createSignedEvent({ kind: 1, tags: [] })

      const filters = [
        { kinds: [1], '#e': ['event1'] },  // kind matches but tag doesn't
        { kinds: [2] }                      // kind doesn't match
      ]
      t.notOk(match_any_filter(event, filters), 'no filter fully matches')
      t.end()
    })

    st.end()
  })

  t.test('match_tags', st => {
    st.test('matches tag by key and value', t => {
      const tags    = [['e', 'abc'], ['p', 'def']]
      const filters = [['e', 'abc']] as [string, string][]

      t.ok(match_tags(filters, tags), 'matches when tag present')
      t.end()
    })

    st.test('returns false for non-matching value', t => {
      const tags    = [['e', 'abc']]
      const filters = [['e', 'xyz']] as [string, string][]

      t.notOk(match_tags(filters, tags), 'no match for wrong value')
      t.end()
    })

    st.test('returns false for non-matching key', t => {
      const tags    = [['e', 'abc']]
      const filters = [['p', 'abc']] as [string, string][]

      t.notOk(match_tags(filters, tags), 'no match for wrong key')
      t.end()
    })

    st.test('returns false for empty tags', t => {
      const tags: string[][] = []
      const filters = [['e', 'abc']] as [string, string][]

      t.notOk(match_tags(filters, tags), 'no match for empty tags')
      t.end()
    })

    st.test('returns true for empty filters (nothing to check)', t => {
      const tags    = [['e', 'abc']]
      const filters: [string, string][] = []

      t.ok(match_tags(filters, tags), 'empty filters means nothing to check')
      t.end()
    })

    st.test('AND logic across different tag types', t => {
      const tags = [['e', 'abc'], ['p', 'def']]

      // Both tag types present
      t.ok(match_tags([['e', 'abc'], ['p', 'def']], tags), 'matches when both tags present')

      // Missing one tag type
      t.notOk(match_tags([['e', 'abc'], ['x', 'missing']], tags), 'fails when one tag type missing')

      t.end()
    })

    st.test('OR logic within same tag type', t => {
      const tags = [['e', 'abc']]

      // Multiple values for same tag type - OR logic
      t.ok(match_tags([['e', 'abc'], ['e', 'xyz']], tags), 'matches when one of values present')
      t.ok(match_tags([['e', 'xyz'], ['e', 'abc']], tags), 'matches regardless of order')
      t.notOk(match_tags([['e', 'xyz'], ['e', 'qrs']], tags), 'fails when none match')

      t.end()
    })

    st.test('combined AND and OR logic', t => {
      const tags = [['e', 'event1'], ['p', 'pubkey1']]

      // Multiple values per tag type + multiple tag types
      const filters: [string, string][] = [['e', 'event1'], ['e', 'event2'], ['p', 'pubkey1'], ['p', 'pubkey2']]
      t.ok(match_tags(filters, tags), 'matches with multiple values and types')

      // Has e tag but missing p tag
      const tags2 = [['e', 'event1']]
      t.notOk(match_tags(filters, tags2), 'fails when p tag missing')

      t.end()
    })

    st.end()
  })

  t.test('get_tag_filters', st => {
    st.test('extracts tag filters from filter object', t => {
      const filter = { '#e': ['event1'], '#p': ['pubkey1'], kinds: [1] }
      const tags   = get_tag_filters(filter)

      t.ok(tags.some(([k, v]) => k === 'e' && v === 'event1'), 'extracts e tag')
      t.ok(tags.some(([k, v]) => k === 'p' && v === 'pubkey1'), 'extracts p tag')
      t.end()
    })

    st.test('returns empty array for no tag filters', t => {
      const filter = { kinds: [1], authors: ['abc'] }
      const tags   = get_tag_filters(filter)

      t.deepEqual(tags, [], 'no tag filters')
      t.end()
    })

    st.test('ignores empty tag arrays', t => {
      const filter = { '#e': [], '#p': ['pubkey1'] }
      const tags   = get_tag_filters(filter)

      t.equal(tags.length, 1, 'ignores empty array')
      t.end()
    })

    st.test('extracts all values from tag filter arrays', t => {
      const filter = { '#e': ['event1', 'event2', 'event3'] }
      const tags   = get_tag_filters(filter)

      t.equal(tags.length, 3, 'extracts all values')
      t.ok(tags.some(([k, v]) => k === 'e' && v === 'event1'), 'has event1')
      t.ok(tags.some(([k, v]) => k === 'e' && v === 'event2'), 'has event2')
      t.ok(tags.some(([k, v]) => k === 'e' && v === 'event3'), 'has event3')
      t.end()
    })

    st.test('extracts full tag name (not just first char)', t => {
      const filter = { '#custom': ['value1'] }
      const tags   = get_tag_filters(filter)

      t.equal(tags.length, 1, 'extracts custom tag')
      t.deepEqual(tags[0], ['custom', 'value1'], 'preserves full tag name')
      t.end()
    })

    st.test('handles multiple tags with multiple values', t => {
      const filter = { '#e': ['e1', 'e2'], '#p': ['p1', 'p2'] }
      const tags   = get_tag_filters(filter)

      t.equal(tags.length, 4, 'extracts all tag/value pairs')
      t.ok(tags.some(([k, v]) => k === 'e' && v === 'e1'), 'has e:e1')
      t.ok(tags.some(([k, v]) => k === 'e' && v === 'e2'), 'has e:e2')
      t.ok(tags.some(([k, v]) => k === 'p' && v === 'p1'), 'has p:p1')
      t.ok(tags.some(([k, v]) => k === 'p' && v === 'p2'), 'has p:p2')
      t.end()
    })

    st.end()
  })

  t.test('process_filters', st => {
    st.test('filters events by multiple filters', t => {
      const event1 = createSignedEvent({ kind: 1 })
      const event2 = createSignedEvent({ kind: 2 })
      const event3 = createSignedEvent({ kind: 3 })
      const events = [event1, event2, event3]

      const results = process_filters(events, [{ kinds: [1] }, { kinds: [3] }])
      t.equal(results.length, 2, 'returns matching events')
      t.ok(results.includes(event1), 'includes kind 1')
      t.ok(results.includes(event3), 'includes kind 3')
      t.end()
    })

    st.test('respects limit per filter', t => {
      const events = Array.from({ length: 10 }, () => createSignedEvent({ kind: 1 }))
      const results = process_filters(events, [{ kinds: [1], limit: 3 }])

      t.equal(results.length, 3, 'respects limit')
      t.end()
    })

    st.test('returns empty for no matches', t => {
      const event = createSignedEvent({ kind: 1 })
      const results = process_filters([event], [{ kinds: [2] }])

      t.deepEqual(results, [], 'no matches returns empty array')
      t.end()
    })

    st.test('multiple filters with limits each', t => {
      const events1 = Array.from({ length: 5 }, () => createSignedEvent({ kind: 1 }))
      const events2 = Array.from({ length: 5 }, () => createSignedEvent({ kind: 2 }))
      const events  = [...events1, ...events2]

      const results = process_filters(events, [
        { kinds: [1], limit: 2 },
        { kinds: [2], limit: 2 }
      ])

      t.equal(results.length, 4, 'respects per-filter limits')
      t.equal(results.filter(e => e.kind === 1).length, 2, 'has 2 kind 1 events')
      t.equal(results.filter(e => e.kind === 2).length, 2, 'has 2 kind 2 events')
      t.end()
    })

    st.test('filter with tag conditions', t => {
      const event1 = createSignedEvent({ kind: 1, tags: [['e', 'abc']] })
      const event2 = createSignedEvent({ kind: 1, tags: [['e', 'xyz']] })
      const event3 = createSignedEvent({ kind: 1, tags: [] })
      const events = [event1, event2, event3]

      const results = process_filters(events, [{ kinds: [1], '#e': ['abc'] }])

      t.equal(results.length, 1, 'only matches event with correct tag')
      t.equal(results[0].id, event1.id, 'matches correct event')
      t.end()
    })

    st.test('empty filters array returns empty', t => {
      const event = createSignedEvent()
      const results = process_filters([event], [])

      t.deepEqual(results, [], 'empty filters returns empty array')
      t.end()
    })

    st.end()
  })

  t.test('get_event_cache_key', st => {
    st.test('returns event id for regular events', t => {
      const event = createSignedEvent({ kind: 1 })
      const key   = get_event_cache_key(event)

      t.equal(key, event.id, 'uses event id')
      t.end()
    })

    st.test('returns pubkey:kind for replaceable events (kind 0)', t => {
      const seckey = gen_seckey()
      const pubkey = get_pubkey(seckey)
      const event  = sign_event(
        create_event({ content: '', kind: 0, pubkey }),
        seckey
      )
      const key = get_event_cache_key(event)

      t.equal(key, `${pubkey}:0`, 'uses pubkey:kind format')
      t.end()
    })

    st.test('returns pubkey:kind for replaceable events (kind 10000-19999)', t => {
      const seckey = gen_seckey()
      const pubkey = get_pubkey(seckey)
      const event  = sign_event(
        create_event({ content: '', kind: 10000, pubkey }),
        seckey
      )
      const key = get_event_cache_key(event)

      t.equal(key, `${pubkey}:10000`, 'uses pubkey:kind format')
      t.end()
    })

    st.test('returns null for ephemeral events (kind 20000-29999)', t => {
      const event = createSignedEvent({ kind: 20000 })
      const key   = get_event_cache_key(event)

      t.equal(key, null, 'returns null for ephemeral')
      t.end()
    })

    st.test('returns pubkey:kind:d for addressable events (kind 30000-39999)', t => {
      const seckey = gen_seckey()
      const pubkey = get_pubkey(seckey)
      const event  = sign_event(
        create_event({ content: '', kind: 30000, pubkey, tags: [['d', 'identifier']] }),
        seckey
      )
      const key = get_event_cache_key(event)

      t.equal(key, `${pubkey}:30000:identifier`, 'uses pubkey:kind:d format')
      t.end()
    })

    st.test('handles missing d tag for addressable events', t => {
      const seckey = gen_seckey()
      const pubkey = get_pubkey(seckey)
      const event  = sign_event(
        create_event({ content: '', kind: 30000, pubkey }),
        seckey
      )
      const key = get_event_cache_key(event)

      t.equal(key, `${pubkey}:30000:`, 'uses empty string for missing d tag')
      t.end()
    })

    st.end()
  })

  t.test('is_kind_regular', st => {
    st.test('returns true for kind 1', t => {
      t.ok(is_kind_regular(1), 'kind 1 is regular')
      t.end()
    })

    st.test('returns true for kind 2', t => {
      t.ok(is_kind_regular(2), 'kind 2 is regular')
      t.end()
    })

    st.test('returns true for kinds 4-44', t => {
      t.ok(is_kind_regular(4), 'kind 4 is regular')
      t.ok(is_kind_regular(44), 'kind 44 is regular')
      t.end()
    })

    st.test('returns true for kinds 1000-9999', t => {
      t.ok(is_kind_regular(1000), 'kind 1000 is regular')
      t.ok(is_kind_regular(9999), 'kind 9999 is regular')
      t.end()
    })

    st.test('returns false for kind 0', t => {
      t.notOk(is_kind_regular(0), 'kind 0 is not regular')
      t.end()
    })

    st.test('returns false for kind 3', t => {
      t.notOk(is_kind_regular(3), 'kind 3 is not regular')
      t.end()
    })

    st.end()
  })

  t.test('is_kind_replace', st => {
    st.test('returns true for kind 0', t => {
      t.ok(is_kind_replace(0), 'kind 0 is replaceable')
      t.end()
    })

    st.test('returns true for kind 3', t => {
      t.ok(is_kind_replace(3), 'kind 3 is replaceable')
      t.end()
    })

    st.test('returns true for kinds 4-44', t => {
      t.ok(is_kind_replace(4), 'kind 4 is replaceable')
      t.ok(is_kind_replace(44), 'kind 44 is replaceable')
      t.end()
    })

    st.test('returns true for kinds 10000-19999', t => {
      t.ok(is_kind_replace(10000), 'kind 10000 is replaceable')
      t.ok(is_kind_replace(19999), 'kind 19999 is replaceable')
      t.end()
    })

    st.test('returns false for kind 1', t => {
      t.notOk(is_kind_replace(1), 'kind 1 is not replaceable')
      t.end()
    })

    st.end()
  })

  t.test('is_kind_ephemeral', st => {
    st.test('returns true for kinds 20000-29999', t => {
      t.ok(is_kind_ephemeral(20000), 'kind 20000 is ephemeral')
      t.ok(is_kind_ephemeral(25000), 'kind 25000 is ephemeral')
      t.ok(is_kind_ephemeral(29999), 'kind 29999 is ephemeral')
      t.end()
    })

    st.test('returns false for kind 1', t => {
      t.notOk(is_kind_ephemeral(1), 'kind 1 is not ephemeral')
      t.end()
    })

    st.test('returns false for kind 30000', t => {
      t.notOk(is_kind_ephemeral(30000), 'kind 30000 is not ephemeral')
      t.end()
    })

    st.end()
  })

  t.test('is_kind_address', st => {
    st.test('returns true for kinds 30000-39999', t => {
      t.ok(is_kind_address(30000), 'kind 30000 is addressable')
      t.ok(is_kind_address(35000), 'kind 35000 is addressable')
      t.ok(is_kind_address(39999), 'kind 39999 is addressable')
      t.end()
    })

    st.test('returns false for kind 1', t => {
      t.notOk(is_kind_address(1), 'kind 1 is not addressable')
      t.end()
    })

    st.test('returns false for kind 29999', t => {
      t.notOk(is_kind_address(29999), 'kind 29999 is not addressable')
      t.end()
    })

    st.end()
  })
}
