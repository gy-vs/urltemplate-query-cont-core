import { describe, expect, it } from 'vitest';
import {
  expand,
  expandWithBase,
  uriTemplate,
  UriTemplateError,
  type Variables,
} from '../src/index.js';

const paging = '{&page,limit}';
const vars: Variables = { page: '2', limit: '10' };

describe('& continuation with no query in the base', () => {
  it('throws in strict mode (the default)', () => {
    expect(() => expand(paging, vars)).toThrowError(UriTemplateError);
    expect(() => expand(paging, vars)).toThrow(/no query/);
    try {
      expand(paging, vars);
      throw new Error('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(UriTemplateError);
      expect((e as UriTemplateError).code).toBe('AMPERSAND_WITHOUT_QUERY');
    }
  });

  it('never emits a query starting bare with &', () => {
    const result = expandWithBase('http://x.test/path', paging, vars, {
      ampersand: 'question-mark',
    });
    expect(result).toBe('http://x.test/path?page=2&limit=10');
  });

  it('compatible mode must be configured explicitly per call', () => {
    expect(() => expandWithBase('http://x.test/path', paging, vars)).toThrowError(
      UriTemplateError,
    );
    expect(
      expandWithBase('/path', paging, vars, { ampersand: 'question-mark' }),
    ).toBe('/path?page=2&limit=10');
  });
});

describe('& continuation with an existing query', () => {
  it('appends pairs with a single &', () => {
    expect(
      expandWithBase('http://x.test/search?q=hello', paging, vars),
    ).toBe('http://x.test/search?q=hello&page=2&limit=10');
  });

  it('keeps duplicate parameters instead of deduplicating them', () => {
    expect(
      expandWithBase('http://x.test/search?page=1', '{&page}', { page: '2' }),
    ).toBe('http://x.test/search?page=1&page=2');
  });

  it('works with relative URIs that carry a query', () => {
    expect(expandWithBase('/search?q=a', paging, vars)).toBe(
      '/search?q=a&page=2&limit=10',
    );
  });
});

describe('empty / trailing bare "?" query', () => {
  it('continues directly with no doubled separator', () => {
    expect(expandWithBase('http://x.test/search?', '{&page}', { page: '2' })).toBe(
      'http://x.test/search?page=2',
    );
  });

  it('preserves the bare "?" deterministically when nothing is produced', () => {
    expect(expandWithBase('http://x.test/search?', paging, {})).toBe(
      'http://x.test/search?',
    );
  });

  it('strict mode treats a bare "?" as a real query context', () => {
    expect(expandWithBase('http://x.test/search?', '{&page}', { page: '2' })).toBe(
      'http://x.test/search?page=2',
    );
  });
});

describe('fragment boundary', () => {
  it('does not treat a fragment as query context in strict mode', () => {
    expect(() =>
      expandWithBase('http://x.test/path#section', '{&page}', { page: '2' }),
    ).toThrowError(UriTemplateError);
  });

  it('inserts the started query before the fragment in compatible mode', () => {
    expect(
      expandWithBase('http://x.test/path#section', '{&page}', { page: '2' }, {
        ampersand: 'question-mark',
      }),
    ).toBe('http://x.test/path?page=2#section');
  });

  it('continues an existing query and keeps the fragment at the end', () => {
    expect(
      expandWithBase('http://x.test/path?q=1#section', '{&page,limit}', vars),
    ).toBe('http://x.test/path?q=1&page=2&limit=10#section');
  });

  it('a literal "?" inside the fragment is not a query', () => {
    expect(() =>
      expandWithBase('http://x.test/path#q?x', '{&page}', { page: '2' }),
    ).toThrowError(UriTemplateError);
    expect(
      expandWithBase('http://x.test/path#q?x', '{&page}', { page: '2' }, {
        ampersand: 'question-mark',
      }),
    ).toBe('http://x.test/path?page=2#q?x');
  });
});

describe('encoded question marks', () => {
  it('does not interpret %3F as a query delimiter', () => {
    const base = 'http://x.test/file%3Fname';
    expect(() => expandWithBase(base, '{&page}', { page: '2' })).toThrowError(
      UriTemplateError,
    );
    expect(
      expandWithBase(base, '{&page}', { page: '2' }, {
        ampersand: 'question-mark',
      }),
    ).toBe('http://x.test/file%3Fname?page=2');
  });

  it('still reads a real query after an encoded question mark', () => {
    expect(
      expandWithBase('http://x.test/file%3Fname?x=1', '{&page}', { page: '2' }),
    ).toBe('http://x.test/file%3Fname?x=1&page=2');
  });
});

describe('separators are written only when a variable produces output', () => {
  it('all variables missing with existing query: base unchanged, no trailing &', () => {
    expect(expandWithBase('http://x.test/path?q=1', paging, {})).toBe(
      'http://x.test/path?q=1',
    );
  });

  it('all variables missing without a query: no "?" appears at all', () => {
    expect(expand('{?page,limit}', {})).toBe('');
    expect(expandWithBase('http://x.test/path', '{?page,limit}', {})).toBe(
      'http://x.test/path',
    );
  });

  it('partial missing values: separators join only produced pairs', () => {
    expect(
      expandWithBase('http://x.test/path?q=1', '{&page,limit}', {
        page: undefined,
        limit: '10',
      }),
    ).toBe('http://x.test/path?q=1&limit=10');
  });

  it('empty-string values are defined and render as name=', () => {
    expect(
      expandWithBase('http://x.test/path?q=1', '{&page,limit}', {
        page: '',
        limit: '10',
      }),
    ).toBe('http://x.test/path?q=1&page=&limit=10');
  });

  it('an empty-string as the only pair still opens the query with ?', () => {
    expect(expand('{?page}', { page: '' })).toBe('?page=');
    expect(
      expandWithBase('http://x.test/path', '{&page}', { page: '' }, {
        ampersand: 'question-mark',
      }),
    ).toBe('http://x.test/path?page=');
  });
});

describe('relative URIs', () => {
  it('bare relative path: strict then compatible', () => {
    expect(() => expandWithBase('search', paging, vars)).toThrowError(
      UriTemplateError,
    );
    expect(
      expandWithBase('search', paging, vars, { ampersand: 'question-mark' }),
    ).toBe('search?page=2&limit=10');
  });

  it('root-relative path without query', () => {
    expect(() => expandWithBase('/a/b', '{&x}', { x: '1' })).toThrowError(
      UriTemplateError,
    );
  });
});

describe('? form-start operator', () => {
  it('starts a query with ?', () => {
    expect(expandWithBase('http://x.test/path', '{?page}', { page: '2' })).toBe(
      'http://x.test/path?page=2',
    );
  });

  it('continues an existing query with & rather than adding a second ?', () => {
    expect(
      expandWithBase('http://x.test/path?q=1', '{?page}', { page: '2' }),
    ).toBe('http://x.test/path?q=1&page=2');
  });

  it('places the query before an existing fragment', () => {
    expect(
      expandWithBase('http://x.test/path#frag', '{?page}', { page: '2' }),
    ).toBe('http://x.test/path?page=2#frag');
  });
});

describe('fragment operator and other expressions', () => {
  it('starts a fragment with #', () => {
    expect(expand('/x{#a}', { a: 'z' })).toBe('/x#z');
  });

  it('continues an existing fragment with a comma', () => {
    expect(expandWithBase('http://x.test/p#a', '{#b}', { b: '2' })).toBe(
      'http://x.test/p#a,2',
    );
  });

  it('encodes values in query pairs', () => {
    expect(
      expandWithBase('http://x.test/s', '{?q}', { q: 'a b&c=d' }, ),
    ).toBe('http://x.test/s?q=a%20b%26c%3Dd');
  });

  it('supports comma-separated multi-variable simple expressions', () => {
    expect(expand('/x/{id,name}', { id: '1', name: 'a b' })).toBe(
      '/x/1,a%20b',
    );
  });

  it('skips missing simple variables', () => {
    expect(expand('/x/{id}', {})).toBe('/x/');
  });
});

describe('state isolation between standalone and base-bound APIs', () => {
  const template = uriTemplate('{&a}');
  const withQuery = uriTemplate('{&a}');

  it('a query context seen by bind() never leaks into expand()', () => {
    expect(withQuery.bind('/p?q=1', { a: '2' })).toBe('/p?q=1&a=2');
    expect(() => template.expand({ a: '2' })).toThrowError(UriTemplateError);
    // repeatedly: no call mutates shared state
    expect(withQuery.bind('/p?q=1', { a: '3' })).toBe('/p?q=1&a=3');
    expect(() => template.expand({ a: '4' })).toThrowError(UriTemplateError);
  });

  it('compatible mode on one call does not change strict default of another', () => {
    expect(template.expand({ a: '2' }, { ampersand: 'question-mark' })).toBe(
      '?a=2',
    );
    expect(() => template.expand({ a: '2' })).toThrowError(UriTemplateError);
    expect(() =>
      template.bind('/plain', { a: '2' }),
    ).toThrowError(UriTemplateError);
    expect(
      template.bind('/plain', { a: '2' }, { ampersand: 'question-mark' }),
    ).toBe('/plain?a=2');
  });

  it('bind() calls do not leak context between different bases', () => {
    const t = uriTemplate('{&a}');
    expect(t.bind('/p?x=1', { a: '1' })).toBe('/p?x=1&a=1');
    expect(() => t.bind('/p', { a: '1' })).toThrowError(UriTemplateError);
    expect(t.bind('/p?x=1', { a: '2' })).toBe('/p?x=1&a=2');
  });

  it('does not mutate the variables object', () => {
    const input: Variables = { a: '1' };
    const snapshot = { ...input };
    template.expand(input, { ampersand: 'question-mark' });
    expect(input).toEqual(snapshot);
  });
});
