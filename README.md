# URI template core

TypeScript library for template expansion.

Run `npm install`, then `npm test` and `npm run build`.

## API

### `expand(template, variables)`

Standalone template expansion. Supports `{?...}`, `{&...}`, `{;...}`, `{+...}`,
`{#...}` and multi-variable expressions such as `{&page,limit}`, plus `*` explode
for lists and records. A `?`/`&`/`;` expression writes its leading separator only
when at least one variable actually produces a pair, so all-missing variables
leave no dangling `?` or `&`. Empty strings still produce `name=`; empty lists
and records count as missing.

### `expandInto(baseUri, template, variables, options?)`

Expands a template against a base URI (absolute or relative), respecting query
and fragment boundaries:

- `?`/`&` expressions merge into the base's query component, always inserted
  before any `#fragment`.
- `{&...}` continues an existing query with `&`. If the base has no query
  component, the default **strict** mode throws `MissingQueryContextError`;
  pass `{ mode: 'compat' }` to downgrade the leading `&` to `?`. Compat mode
  is never implied — it must be configured explicitly per call.
- An existing empty trailing `?` counts as a query context: appended pairs
  collapse onto it (`items?` + `page=1` → `items?page=1`, never `items?&page=1`).
  When nothing is produced, the base URI is returned unchanged, dangling `?`
  included.
- Only a literal `?` before any `#` delimits the query. `%3F` in the path and
  `?` inside the fragment are not boundaries.
- Duplicate parameter names are appended, never deduplicated.
- The base URI is passed through byte-for-byte; only template output is
  percent-encoded.

### `bindBaseUri(baseUri, options?)`

Returns a `(template, variables) => string` expander bound to a base URI. The
options are copied and frozen at binding time — nothing is shared with
`expand`, `expandInto`, or other bound expanders.

```ts
import {bindBaseUri, expandInto} from 'urltemplate-query-cont-core';

expandInto('https://api.example.com/items?sort=asc', '{&page,limit}', {page: '1', limit: '10'});
// 'https://api.example.com/items?sort=asc&page=1&limit=10'

const bound = bindBaseUri('https://api.example.com/items#list', {mode: 'compat'});
bound('{&page}', {page: '2'});
// 'https://api.example.com/items?page=2#list'
```
