# URI template core

TypeScript library for template expansion with query/fragment-boundary awareness.

Run `npm install`, then `npm test` and `npm run build`.

## API

```ts
import { expand, expandWithBase, uriTemplate } from './dist/index.js';

// Standalone expansion
expand('{?page}', { page: '2' });            // '?page=2'
expand('{&page}', { page: '2' });            // throws UriTemplateError (strict default)
expand('{&page}', { page: '2' }, {
  ampersand: 'question-mark',                // compatible mode, explicit per call
});                                          // '?page=2'

// Bound to a base URI — query and fragment boundaries are understood
expandWithBase('/search?q=a', '{&page,limit}', { page: '2', limit: '10' });
// '/search?q=a&page=2&limit=10'
expandWithBase('/path#frag', '{?page}', { page: '2' });
// '/path?page=2#frag' — the query is inserted before the fragment

// Reusable parsed template; options are never stored between calls
const t = uriTemplate('{&page}');
t.bind('/p?x=1', { page: '2' });             // '/p?x=1&page=2'
t.expand({ page: '2' });                     // throws: contexts never leak
```

## Rules

- `&` continues a query only when one exists (a base ending in a bare `?` counts).
  Otherwise strict mode (default) throws `UriTemplateError` (`AMPERSAND_WITHOUT_QUERY`);
  `{ ampersand: 'question-mark' }` starts the query with `?` instead.
- `?` starts a query with `?`, or continues an existing query with `&`.
- Separators are written only when at least one variable actually produces a pair.
  Missing variables contribute nothing; an empty string still renders `name=`.
- A bare trailing `?` is preserved when no variable produces output.
- Only a literal `?` before `#` starts a query; `%3F` and a `?` inside a fragment do not.
- Duplicate parameters are preserved (no deduplication).
- Options must be passed per call; standalone expansion and base-bound expansion
  share no mutable state.
