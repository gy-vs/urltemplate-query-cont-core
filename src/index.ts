/**
 * URI Template expansion with query/fragment-boundary awareness.
 *
 * Supported operators: none (simple), +, #, ?, &, ; — with comma-separated
 * multi-variable expressions (RFC 6570 form level-3, excluding modifiers
 * beyond `*` which is accepted for compatibility).
 */

export type Variables = Record<
  string,
  string | string[] | Record<string, string> | undefined
>;

/**
 * - `"strict"`: `&` outside a query context is an error.
 * - `"question-mark"`: compatible mode — the continuation is rewritten to `?`.
 */
export type AmpersandMode = 'strict' | 'question-mark';

export interface ExpandOptions {
  /**
   * How a form-continuation operator (`&`) behaves when the URI has no
   * existing query. Must be configured explicitly per call; it defaults to
   * `"strict"`.
   */
  ampersand?: AmpersandMode;
}

/** Thrown when a template cannot be expanded under the requested policy. */
export class UriTemplateError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'UriTemplateError';
    this.code = code;
  }
}

interface ParsedExpression {
  type: 'expression';
  operator: '' | '+' | '#' | '?' | '&' | ';';
  names: string[];
}

type Token = { type: 'literal'; text: string } | ParsedExpression;

const TOKEN_RE = /\{([+#?&;]?)([a-zA-Z0-9_,]+)\*?\}/g;

function parse(template: string): Token[] {
  const tokens: Token[] = [];
  let last = 0;
  for (const match of template.matchAll(TOKEN_RE)) {
    if (match.index! > last) {
      tokens.push({ type: 'literal', text: template.slice(last, match.index) });
    }
    tokens.push({
      type: 'expression',
      operator: (match[1] || '') as ParsedExpression['operator'],
      names: match[2].split(','),
    });
    last = match.index! + match[0].length;
  }
  if (last < template.length) {
    tokens.push({ type: 'literal', text: template.slice(last) });
  }
  return tokens;
}

/** A defined, non-empty collection/object still renders. Empty string is a value. */
function isDefined(v: Variables[string]): v is NonNullable<Variables[string]> {
  return v !== undefined && v !== null;
}

function encodeValue(v: string): string {
  return encodeURIComponent(v);
}

/** Flatten a defined variable into its comma-separated, encoded expansion text. */
function flatten(value: NonNullable<Variables[string]>): string {
  if (typeof value === 'string') return encodeValue(value);
  if (Array.isArray(value)) {
    return value.map((item) => encodeValue(item)).join(',');
  }
  return Object.entries(value)
    .flatMap(([k, val]) => [k, val])
    .map((item) => encodeValue(item))
    .join(',');
}

/** Render one `name=value` query pair, or null if the variable is absent/empty collection. */
function queryPair(
  name: string,
  value: Variables[string],
): string | null {
  if (!isDefined(value)) return null;
  if (Array.isArray(value)) {
    if (value.length === 0) return null;
    return `${name}=${value.map(encodeValue).join(',')}`;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value);
    if (entries.length === 0) return null;
    return `${name}=${entries
      .flatMap(([k, v]) => [k, v])
      .map(encodeValue)
      .join(',')}`;
  }
  // An empty string is still a defined value: `name=`.
  return `${name}=${encodeValue(value)}`;
}

interface BaseParts {
  /** Everything before the first `?` / `#` of the base. */
  path: string;
  query: string;
  fragment: string;
  hasQuery: boolean;
  hasFragment: boolean;
}

/**
 * Split a base URI at its query/fragment boundaries.
 * Only a literal `?` in the pre-fragment portion starts a query; an encoded
 * `%3f` or a `?` after `#` is ordinary content.
 */
function splitBase(base: string): BaseParts {
  const hashIndex = base.indexOf('#');
  const preFragment = hashIndex === -1 ? base : base.slice(0, hashIndex);
  const fragment = hashIndex === -1 ? '' : base.slice(hashIndex + 1);
  const queryIndex = preFragment.indexOf('?');
  if (queryIndex === -1) {
    return {
      path: preFragment,
      query: '',
      fragment,
      hasQuery: false,
      hasFragment: hashIndex !== -1,
    };
  }
  return {
    path: preFragment.slice(0, queryIndex),
    query: preFragment.slice(queryIndex + 1),
    fragment,
    hasQuery: true,
    hasFragment: hashIndex !== -1,
  };
}

type Section = 'path' | 'query' | 'fragment';

interface RenderState {
  path: string;
  query: string;
  hasQuery: boolean;
  fragment: string;
  hasFragment: boolean;
  section: Section;
}

/** Append literal text, switching sections on literal `?` / `#`. */
function appendLiteral(state: RenderState, text: string): void {
  if (!text) return;
  let remaining = text;
  while (remaining.length > 0) {
    if (state.section === 'path') {
      const q = remaining.indexOf('?');
      const h = remaining.indexOf('#');
      const next = [q, h].filter((i) => i !== -1).sort((a, b) => a - b)[0];
      if (next === undefined) {
        state.path += remaining;
        return;
      }
      state.path += remaining.slice(0, next);
      const delim = remaining[next];
      remaining = remaining.slice(next + 1);
      if (delim === '?') {
        state.hasQuery = true;
        state.section = 'query';
      } else {
        state.hasFragment = true;
        state.section = 'fragment';
      }
    } else if (state.section === 'query') {
      const h = remaining.indexOf('#');
      if (h === -1) {
        state.query += remaining;
        return;
      }
      state.query += remaining.slice(0, h);
      remaining = remaining.slice(h + 1);
      state.hasFragment = true;
      state.section = 'fragment';
    } else {
      state.fragment += remaining;
      return;
    }
  }
}

function renderExpansion(
  tokens: Token[],
  base: string,
  variables: Variables,
  options: Required<ExpandOptions>,
): string {
  const parts = splitBase(base);
  const state: RenderState = {
    path: parts.path,
    query: parts.query,
    hasQuery: parts.hasQuery,
    fragment: parts.fragment,
    hasFragment: parts.hasFragment,
    section: parts.hasQuery ? 'query' : parts.hasFragment ? 'fragment' : 'path',
  };

  for (const token of tokens) {
    if (token.type === 'literal') {
      appendLiteral(state, token.text);
      continue;
    }

    const { operator, names } = token;

    if (operator === '?' || operator === '&') {
      // The separator is decided *after* we know the expression actually
      // produces at least one pair.
      const pairs: string[] = [];
      for (const name of names) {
        const pair = queryPair(name, variables[name]);
        if (pair !== null) pairs.push(pair);
      }
      if (pairs.length === 0) continue;

      if (operator === '&' && !state.hasQuery) {
        if (options.ampersand === 'strict') {
          throw new UriTemplateError(
            'AMPERSAND_WITHOUT_QUERY',
            `Form-continuation operator '&' (variables: ${names.join(', ')}) ` +
              'cannot be used when the URI has no query. Configure ' +
              "{ ampersand: 'question-mark' } to start the query with '?' instead.",
          );
        }
        // compatible mode: start a fresh query
        state.hasQuery = true;
      }

      // Query output always belongs to the query component; assembly places
      // it before the fragment, so a query expression in a template that also
      // has a fragment never gets appended after '#'.
      const body = pairs.join('&');
      state.hasQuery = true;
      state.section = 'query';
      // An empty query ("" or a base ending in a bare "?") needs no connector.
      state.query += state.query ? '&' + body : body;
      continue;
    }

    if (operator === '#') {
      const values = names.filter((n) => isDefined(variables[n])).map((n) => flatten(variables[n]!));
      if (values.length === 0) continue;
      const body = values.join(',');
      state.hasFragment = true;
      if (state.section !== 'fragment') state.section = 'fragment';
      state.fragment += state.fragment ? (state.fragment.endsWith('#') ? body : ',' + body) : body;
      continue;
    }

    // Simple / reserved / path-style parameter expressions render as literals
    // in whatever section we're currently in.
    const values = names.filter((n) => isDefined(variables[n])).map((n) => {
      const flat = flatten(variables[n]!);
      return operator === '+' ? flat.replace(/%2F/gi, '/') : flat;
    });
    if (values.length === 0) continue;
    let rendered = values.join(',');
    if (operator === ';') {
      // Legacy form: ;name=value pairs (first variable defines the name; keep
      // the historical single-parameter shape).
      const name = names[0];
      const raw = variables[name];
      rendered = ';' + name + (raw === '' ? '' : '=' + values.join(','));
    }

    if (state.section === 'query') state.query += rendered;
    else if (state.section === 'fragment') state.fragment += rendered;
    else state.path += rendered;
  }

  let result = state.path;
  if (state.hasQuery) result += '?' + state.query;
  if (state.hasFragment) result += '#' + state.fragment;
  return result;
}

/**
 * A parsed, immutable template. Options are never stored on the instance:
 * every expansion receives its own configuration, so independent expansion
 * calls and base-URI-bound calls cannot share mutable state.
 */
export interface UriTemplate {
  /** Expand without a base URI (relative, starting at empty). */
  expand(variables: Variables, options?: ExpandOptions): string;
  /** Expand against an explicit base URI. */
  bind(base: string, variables: Variables, options?: ExpandOptions): string;
}

class CompiledTemplate implements UriTemplate {
  constructor(private readonly tokens: Token[]) {}

  expand(variables: Variables, options?: ExpandOptions): string {
    return renderExpansion(this.tokens, '', variables, normalizeOptions(options));
  }

  bind(base: string, variables: Variables, options?: ExpandOptions): string {
    return renderExpansion(this.tokens, base, variables, normalizeOptions(options));
  }
}

function normalizeOptions(options?: ExpandOptions): Required<ExpandOptions> {
  return { ampersand: options?.ampersand ?? 'strict' };
}

/** Compile a template. The returned object is safe to reuse across calls. */
export function uriTemplate(template: string): UriTemplate {
  return new CompiledTemplate(parse(template));
}

/**
 * Standalone expansion: `expand("{&a}", {a: "1"})` throws in the default
 * strict mode; pass `{ ampersand: 'question-mark' }` for compatible behavior.
 */
export function expand(template: string, variables: Variables, options?: ExpandOptions): string {
  return renderExpansion(parse(template), '', variables, normalizeOptions(options));
}

/** Expand a template against a base URI. */
export function expandWithBase(
  base: string,
  template: string,
  variables: Variables,
  options?: ExpandOptions,
): string {
  return renderExpansion(parse(template), base, variables, normalizeOptions(options));
}
