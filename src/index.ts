export type Variables=Record<string,string|string[]|Record<string,string>|undefined>;

export type QueryBoundaryMode='strict'|'compat';

export interface ExpandIntoOptions{
  /**
   * How `{&...}` behaves when the base URI has no query component to continue.
   * - 'strict' (default): throw MissingQueryContextError.
   * - 'compat': downgrade the leading '&' to '?'.
   * Compat mode is never implied; it must be passed explicitly per call or per bound expander.
   */
  readonly mode?:QueryBoundaryMode;
}

export class MissingQueryContextError extends Error{
  constructor(message:string){
    super(message);
    this.name='MissingQueryContextError';
  }
}

type TemplatePart=
  |{readonly kind:'text';readonly text:string}
  |{readonly kind:'query';readonly operator:'?'|'&';readonly pairs:readonly string[]};

interface Varspec{
  readonly name:string;
  readonly explode:boolean;
}

const EXPRESSION_PATTERN=/\{([+#?&;]?)([^}]*)\}/g;
const VARSPEC_PATTERN=/^([A-Za-z0-9_.]+)(\*)?$/;
const RESERVED_CHARACTERS=new Set([...":/?#[]@!$&'()*+,;="]);

function encode(text:string,allowReserved:boolean):string{
  const encoded=encodeURIComponent(text);
  if(!allowReserved)return encoded;
  return encoded.replace(/%[0-9A-Fa-f]{2}/g,triple=>{
    const char=String.fromCharCode(Number.parseInt(triple.slice(1),16));
    return RESERVED_CHARACTERS.has(char)?char:triple;
  });
}

function parseVarspecs(source:string):Varspec[]|undefined{
  if(source==='')return undefined;
  const specs:Varspec[]=[];
  for(const piece of source.split(',')){
    const match=VARSPEC_PATTERN.exec(piece);
    if(!match)return undefined;
    specs.push({name:match[1],explode:match[2]==='*'});
  }
  return specs;
}

function expandNamedPairs(operator:string,spec:Varspec,value:string|string[]|Record<string,string>):string[]{
  const name=encode(spec.name,false);
  if(typeof value==='string'){
    return operator===';'&&value===''?[name]:[`${name}=${encode(value,false)}`];
  }
  if(Array.isArray(value)){
    if(value.length===0)return[];
    if(spec.explode)return value.map(entry=>`${name}=${encode(entry,false)}`);
    return[`${name}=${value.map(entry=>encode(entry,false)).join(',')}`];
  }
  const entries=Object.entries(value);
  if(entries.length===0)return[];
  if(spec.explode)return entries.map(([key,entry])=>`${encode(key,false)}=${encode(entry,false)}`);
  return[`${name}=${entries.flat().map(entry=>encode(entry,false)).join(',')}`];
}

function expandTextValue(spec:Varspec,value:string|string[]|Record<string,string>,allowReserved:boolean):string|undefined{
  if(typeof value==='string')return encode(value,allowReserved);
  if(Array.isArray(value)){
    if(value.length===0)return undefined;
    return value.map(entry=>encode(entry,allowReserved)).join(',');
  }
  const entries=Object.entries(value);
  if(entries.length===0)return undefined;
  if(spec.explode)return entries.map(([key,entry])=>`${encode(key,allowReserved)}=${encode(entry,allowReserved)}`).join(',');
  return entries.flat().map(entry=>encode(entry,allowReserved)).join(',');
}

function expandParts(template:string,variables:Variables):TemplatePart[]{
  const parts:TemplatePart[]=[];
  let position=0;
  for(const match of template.matchAll(EXPRESSION_PATTERN)){
    const[raw,operator,specSource]=match;
    const specs=parseVarspecs(specSource);
    if(specs===undefined||match.index===undefined)continue;
    if(match.index>position)parts.push({kind:'text',text:template.slice(position,match.index)});
    position=match.index+raw.length;
    if(operator==='?'||operator==='&'||operator===';'){
      const pairs=specs.flatMap(spec=>{
        const value=variables[spec.name];
        return value===undefined?[]:expandNamedPairs(operator,spec,value);
      });
      if(pairs.length===0)continue;
      if(operator===';')parts.push({kind:'text',text:';'+pairs.join(';')});
      else parts.push({kind:'query',operator,pairs});
      continue;
    }
    const allowReserved=operator==='+'||operator==='#';
    const values=specs.flatMap(spec=>{
      const value=variables[spec.name];
      if(value===undefined)return[];
      const text=expandTextValue(spec,value,allowReserved);
      return text===undefined?[]:[text];
    });
    if(values.length===0)continue;
    parts.push({kind:'text',text:(operator==='#'?'#':'')+values.join(',')});
  }
  if(position<template.length)parts.push({kind:'text',text:template.slice(position)});
  return parts;
}

/** Expands a template on its own. `{&...}` simply emits '&name=value'; no base URI is involved. */
export function expand(template:string,variables:Variables):string{
  return expandParts(template,variables)
    .map(part=>part.kind==='text'?part.text:part.operator+part.pairs.join('&'))
    .join('');
}

interface BaseUriParts{
  readonly head:string;
  readonly query:string|null;
  readonly fragment:string;
}

/**
 * Splits a base URI (absolute or relative) at the first literal '?' (before any '#')
 * and the first '#'. Percent-encoded '%3F' is never a boundary. The base is treated
 * as opaque text and passed through byte-for-byte; only template output is encoded.
 */
function splitBaseUri(baseUri:string):BaseUriParts{
  const hashIndex=baseUri.indexOf('#');
  const headAndQuery=hashIndex===-1?baseUri:baseUri.slice(0,hashIndex);
  const fragment=hashIndex===-1?'':baseUri.slice(hashIndex);
  const queryIndex=headAndQuery.indexOf('?');
  if(queryIndex===-1)return{head:headAndQuery,query:null,fragment};
  return{head:headAndQuery.slice(0,queryIndex),query:headAndQuery.slice(queryIndex+1),fragment};
}

/**
 * Expands a template against a base URI, respecting query/fragment boundaries:
 * - '?'/'&' expressions merge into the base's query component, before any fragment.
 * - A separator is written only when at least one variable actually produces a pair.
 * - An existing empty trailing '?' counts as a query context; appended pairs collapse
 *   onto it ('items?' + p=1 -> 'items?p=1', never 'items?&p=1'). If nothing is
 *   produced the base URI is returned unchanged, dangling '?' included.
 * - Duplicate parameter names are appended, never deduplicated.
 * - All other template output is appended to the head, before the query.
 */
export function expandInto(baseUri:string,template:string,variables:Variables,options:ExpandIntoOptions={}):string{
  const mode=options.mode??'strict';
  const{head,query,fragment}=splitBaseUri(baseUri);
  let suffix='';
  const pairs:string[]=[];
  let hasQueryContext=query!==null;
  for(const part of expandParts(template,variables)){
    if(part.kind==='text'){
      suffix+=part.text;
      continue;
    }
    if(!hasQueryContext){
      if(part.operator==='&'&&mode==='strict'){
        throw new MissingQueryContextError(
          `Cannot expand "${template}": the '&' operator needs an existing query component, `+
          `but the base URI ${JSON.stringify(baseUri)} has none. `+
          `Use '{?...}', add a query to the base URI, or pass { mode: 'compat' } to downgrade '&' to '?'.`
        );
      }
      hasQueryContext=true;
    }
    pairs.push(...part.pairs);
  }
  let result=head+suffix;
  if(query!==null){
    result+='?'+query;
    if(pairs.length>0)result+=(query===''?'':'&')+pairs.join('&');
  }else if(pairs.length>0){
    result+='?'+pairs.join('&');
  }
  return result+fragment;
}

/**
 * Returns an expander bound to a base URI. The options are copied and frozen at
 * binding time; nothing is shared with `expand`, `expandInto`, or other bound expanders.
 */
export function bindBaseUri(baseUri:string,options:ExpandIntoOptions={}):(template:string,variables:Variables)=>string{
  const boundOptions=Object.freeze({...options});
  return(template,variables)=>expandInto(baseUri,template,variables,boundOptions);
}
