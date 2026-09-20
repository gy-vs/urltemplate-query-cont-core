import {describe,expect,it} from 'vitest';
import {bindBaseUri,expand,expandInto,MissingQueryContextError} from '../src/index.js';

describe('standalone expand',()=>{
  it('expands a value',()=>expect(expand('/{id}',{id:'a b'})).toBe('/a%20b'));
  it('expands a multi-variable expression',()=>
    expect(expand('{&page,limit}',{page:'1',limit:'10'})).toBe('&page=1&limit=10'));
  it('writes no separator when every variable is missing',()=>{
    expect(expand('{?q}',{})).toBe('');
    expect(expand('{&page,limit}',{})).toBe('');
    expect(expand('/items{?q}{&page}',{})).toBe('/items');
  });
  it('skips missing variables but keeps empty strings',()=>
    expect(expand('{&page,limit}',{page:'',limit:'10'})).toBe('&page=&limit=10'));
  it('treats an empty list as missing',()=>expect(expand('{&ids}',{ids:[]})).toBe(''));
  it('expands lists and records',()=>{
    expect(expand('{&ids}',{ids:['1','2']})).toBe('&ids=1,2');
    expect(expand('{&ids*}',{ids:['1','2']})).toBe('&ids=1&ids=2');
    expect(expand('{&m}',{m:{a:'1',b:'2'}})).toBe('&m=a,1,b,2');
    expect(expand('{&m*}',{m:{a:'1',b:'2'}})).toBe('&a=1&b=2');
  });
  it('allows reserved characters with +',()=>expect(expand('{+p}',{p:'/a?b'})).toBe('/a?b'));
});

describe('expandInto with no query on the base URI',()=>{
  const base='https://api.example.com/items';
  it('throws in the default strict mode',()=>
    expect(()=>expandInto(base,'{&page,limit}',{page:'1',limit:'10'})).toThrowError(MissingQueryContextError));
  it('downgrades & to ? in explicitly configured compat mode',()=>
    expect(expandInto(base,'{&page,limit}',{page:'1',limit:'10'},{mode:'compat'})).toBe(
      'https://api.example.com/items?page=1&limit=10'));
  it('accepts {?...} without any mode',()=>
    expect(expandInto(base,'{?page}',{page:'1'})).toBe('https://api.example.com/items?page=1'));
  it('appends literal template text to the head before the query',()=>
    expect(expandInto('https://api.example.com','/v2/items{&page}',{page:'1'},{mode:'compat'})).toBe(
      'https://api.example.com/v2/items?page=1'));
});

describe('expandInto with an existing query',()=>{
  it('continues with & in strict mode',()=>
    expect(expandInto('https://api.example.com/items?sort=asc','{&page,limit}',{page:'1',limit:'10'})).toBe(
      'https://api.example.com/items?sort=asc&page=1&limit=10'));
  it('merges a {?...} expression into the existing query with &',()=>
    expect(expandInto('https://api.example.com/items?sort=asc','{?q}',{q:'x'})).toBe(
      'https://api.example.com/items?sort=asc&q=x'));
});

describe('expandInto with an empty trailing query marker',()=>{
  it('treats it as a query context and collapses the first pair onto it',()=>
    expect(expandInto('https://api.example.com/items?','{&page}',{page:'1'})).toBe(
      'https://api.example.com/items?page=1'));
  it('leaves the dangling ? untouched when nothing is produced',()=>
    expect(expandInto('https://api.example.com/items?','{&page}',{})).toBe('https://api.example.com/items?'));
});

describe('expandInto with a fragment',()=>{
  it('inserts the query before the fragment',()=>
    expect(expandInto('https://api.example.com/items#details','{&page}',{page:'1'},{mode:'compat'})).toBe(
      'https://api.example.com/items?page=1#details'));
  it('continues an existing query and keeps the fragment last',()=>
    expect(expandInto('https://api.example.com/items?sort=asc#details','{&page}',{page:'1'})).toBe(
      'https://api.example.com/items?sort=asc&page=1#details'));
  it('does not treat a ? inside the fragment as a query boundary',()=>{
    expect(()=>expandInto('https://api.example.com/items#faq?a','{&page}',{page:'1'})).toThrowError(
      MissingQueryContextError);
    expect(expandInto('https://api.example.com/items#faq?a','{&page}',{page:'1'},{mode:'compat'})).toBe(
      'https://api.example.com/items?page=1#faq?a');
  });
});

describe('expandInto with an encoded question mark',()=>{
  it('does not treat %3F in the path as a query boundary',()=>{
    const base='https://api.example.com/items%3Ftype=a';
    expect(()=>expandInto(base,'{&page}',{page:'1'})).toThrowError(MissingQueryContextError);
    expect(expandInto(base,'{&page}',{page:'1'},{mode:'compat'})).toBe(
      'https://api.example.com/items%3Ftype=a?page=1');
  });
  it('continues a real query whose value contains %3F',()=>
    expect(expandInto('https://api.example.com/items?redirect=%3F','{&page}',{page:'1'})).toBe(
      'https://api.example.com/items?redirect=%3F&page=1'));
});

describe('expandInto with missing or empty variables',()=>{
  const base='https://api.example.com/items?sort=asc';
  it('returns the base URI unchanged when every variable is missing',()=>{
    expect(expandInto(base,'{&page,limit}',{})).toBe(base);
    expect(expandInto('https://api.example.com/items','{&page,limit}',{})).toBe(
      'https://api.example.com/items');
  });
  it('does not throw in strict mode when nothing is produced',()=>
    expect(()=>expandInto('https://api.example.com/items','{&page,limit}',{})).not.toThrow());
  it('writes a separator only for variables that produce output',()=>{
    expect(expandInto(base,'{&page,limit}',{limit:'10'})).toBe(
      'https://api.example.com/items?sort=asc&limit=10');
    expect(expandInto('https://api.example.com/items','{&page,limit}',{limit:'10'},{mode:'compat'})).toBe(
      'https://api.example.com/items?limit=10');
  });
  it('keeps empty-string values as name=',()=>
    expect(expandInto(base,'{&page}',{page:''})).toBe('https://api.example.com/items?sort=asc&page='));
});

describe('expandInto with duplicate parameters',()=>{
  it('appends instead of deduplicating',()=>
    expect(expandInto('https://api.example.com/items?page=1','{&page}',{page:'2'})).toBe(
      'https://api.example.com/items?page=1&page=2'));
});

describe('expandInto with relative URIs',()=>{
  it('continues the query of a relative URI',()=>
    expect(expandInto('/items?x=1','{&p}',{p:'1'})).toBe('/items?x=1&p=1'));
  it('downgrades to ? for a relative URI without a query in compat mode',()=>
    expect(expandInto('/items','{&p}',{p:'1'},{mode:'compat'})).toBe('/items?p=1'));
  it('handles a query-only base',()=>
    expect(expandInto('?x=1','{&p}',{p:'1'})).toBe('?x=1&p=1'));
  it('handles a fragment-only base',()=>
    expect(expandInto('#frag','{&p}',{p:'1'},{mode:'compat'})).toBe('?p=1#frag'));
});

describe('state isolation between APIs',()=>{
  it('defaults every expandInto call to strict regardless of other calls',()=>{
    expandInto('https://api.example.com/items','{&p}',{p:'1'},{mode:'compat'});
    expect(()=>expandInto('https://api.example.com/items','{&p}',{p:'1'})).toThrowError(
      MissingQueryContextError);
  });
  it('never lets bound options leak into standalone expand',()=>{
    const bound=bindBaseUri('https://api.example.com/items',{mode:'compat'});
    expect(bound('{&p}',{p:'1'})).toBe('https://api.example.com/items?p=1');
    expect(expand('{&p}',{p:'1'})).toBe('&p=1');
  });
  it('keeps bound expanders independent from each other',()=>{
    const compat=bindBaseUri('https://api.example.com/items',{mode:'compat'});
    const strict=bindBaseUri('https://api.example.com/items');
    expect(compat('{&p}',{p:'1'})).toBe('https://api.example.com/items?p=1');
    expect(()=>strict('{&p}',{p:'1'})).toThrowError(MissingQueryContextError);
  });
  it('does not mutate the caller-provided options object',()=>{
    const options={mode:'compat'} as const;
    expandInto('https://api.example.com/items','{&p}',{p:'1'},options);
    bindBaseUri('https://api.example.com/items',options)('{&p}',{p:'1'});
    expect(options).toEqual({mode:'compat'});
  });
});
