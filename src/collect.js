/* Programme: Actualites publiques - Collecte bornee, cache et reprise sur erreur
   Date: 2026-09-14 - Auteur: nemesiaa */
import {sources,parseInasti,parseRss,mergeItems} from './feeds.js';
import {collectDocuments} from './fisconet.js';
import {extractBelgium} from './content.js';
import {parseSpwRss,readSpwArticle,parseFisconet} from './providers.js';
import {isImportantFeedItem} from './importance-filter.js';

function importantItems(key,items) {
  // Eviter de modifier l ordre ou la reference quand le filtre ne retire rien.
  const filtered=items.filter(item=>isImportantFeedItem(key,item));
  return filtered.length===items.length?items:filtered;
}

async function completeBelgium(items,previous,fetcher,now) {
  // Le RSS ne contient que les introductions; visiter les articles au plus une fois par heure.
  const errors=[],completed=[];
  for(const item of items){
    const cached=previous.items?.find(old=>old.id===item.id||old.link===item.link);
    try{
      const headers={Accept:'text/html'};
      if(cached?.articleEtag)headers['If-None-Match']=cached.articleEtag;
      if(cached?.articleLastModified)headers['If-Modified-Since']=cached.articleLastModified;
      const response=await download(item.link,sources.belgium,headers,fetcher);
      if(response.notModified){
        if(!cached?.contentComplete)throw new Error('HTTP 304 sans corps integral en cache.');
        completed.push({...item,content:cached.content,contentComplete:true,articleEtag:cached.articleEtag,articleLastModified:cached.articleLastModified});
      }else{
        if(!/html/i.test(response.type))throw new Error('Article: Content-Type non HTML.');
        completed.push({...item,content:extractBelgium(response.body,item.link),contentComplete:true,articleEtag:response.etag,articleLastModified:response.lastModified});
      }
    }catch(error){
      errors.push({url:item.link,error:error.message});
      completed.push({...item,content:cached?.contentComplete?cached.content:item.content,contentComplete:!!cached?.contentComplete,contentError:error.message});
    }
  }
  if(errors.length)throw new Error(`Belgium.be: ${errors.length} corps d'article non recuperes; ${errors[0].url}: ${errors[0].error}`);
  return {items:completed,contentErrors:errors,contentCheckedAt:new Date(now).toISOString()};
}

export async function download(url,source,headers={},fetcher=fetch) {
  // Suivre au plus trois redirections, uniquement HTTPS sur le domaine officiel.
  for(let hop=0;hop<=3;hop++){
    const target=new URL(url);
    if(target.protocol!=='https:'||target.hostname!==source.host||target.port||target.username||target.password)throw new Error('Destination de collecte interdite.');
    const response=await fetcher(target.href,{redirect:'manual',headers:{'User-Agent':'ActualitesPubliques-RSS/1.0',...headers},signal:AbortSignal.timeout(20000)});
    if([301,302,303,307,308].includes(response.status)){
      await response.body?.cancel();
      if(!response.headers.get('location'))throw new Error('Redirection sans destination.');
      url=new URL(response.headers.get('location'),url).href;continue;
    }
    if(response.status===304)return {notModified:true};
    if(!response.ok){await response.body?.cancel();throw new Error(`Source HTTP ${response.status}.`);}
    const reader=response.body.getReader(),parts=[];let size=0;
    try{
      for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>2_000_000)throw new Error('Reponse source trop volumineuse.');parts.push(value);}
    }finally{await reader.cancel();}
    const bytes=new Uint8Array(size);let offset=0;
    for(const part of parts){bytes.set(part,offset);offset+=part.length;}
    return {body:new TextDecoder('utf-8',{fatal:true}).decode(bytes),type:response.headers.get('content-type')||'',
      etag:response.headers.get('etag'),lastModified:response.headers.get('last-modified')};
  }
  throw new Error('Trop de redirections.');
}
export async function collect(key,previous={},fetcher=fetch,now=Date.now()) {
  // Preferer le corps JSON INASTI et RSS SPF; ouvrir les articles Belgium dont le RSS est abrege.
  if(key==='fisconetplus'){
    return collectDocuments(previous,async url=>{
      // Utiliser uniquement l API officielle observee, avec les entetes de langue publics.
      const response=await download(url,sources[key],{Accept:'application/json','Accept-Language':'fr',fragmentid:'fisconetplus'},fetcher);
      if(!/json/i.test(response.type))throw new Error('Fisconetplus: reponse non JSON.');
      return response.body;
    },now);
  }
  if(key==='spw-finances'){
    const source=sources[key],response=await download(source.url,source,{Accept:'application/rss+xml, application/xml'},fetcher);
    if(!/xml/i.test(response.type))throw new Error('SPW: index non RSS/XML.');
    const items=[];
    for(const item of parseSpwRss(response.body)){
      const old=previous.items?.find(cached=>cached.sourceLink===item.sourceLink||cached.id===item.id),headers={Accept:'text/html'};
      if(old?.content&&old.articleEtag)headers['If-None-Match']=old.articleEtag;
      if(old?.content&&old.articleLastModified)headers['If-Modified-Since']=old.articleLastModified;
      const page=await download(old?.link||item.link,source,headers,fetcher);
      if(page.notModified){if(!old?.content)throw new Error('SPW: 304 sans corps en cache.');items.push({...old,title:item.title,summary:item.summary});}
      else{
        if(!/html/i.test(page.type))throw new Error('SPW: article non HTML.');
        items.push({...item,...readSpwArticle(page.body,item.link),articleEtag:page.etag,articleLastModified:page.lastModified});
      }
    }
    return {items,etag:null,lastModified:null};
  }
  const source=sources[key],headers={Accept:source.kind==='jsonapi'?'application/vnd.api+json':'application/rss+xml, application/xml, text/xml'};
  // Les pages JSON:API suivantes peuvent changer independamment de la premiere.
  const contentReady=previous.items?.length&&previous.items.every(item=>item.content);
  if(source.kind==='rss'&&contentReady&&previous.etag)headers['If-None-Match']=previous.etag;
  if(source.kind==='rss'&&contentReady&&previous.lastModified)headers['If-Modified-Since']=previous.lastModified;
  let response,parsedItems;
  try{
    response=await download(source.url,source,headers,fetcher);
    if(source.kind==='rss'&&!response.notModified){
      if(!/xml/i.test(response.type))throw new Error('RSS: Content-Type non XML.');
      parsedItems=parseRss(response.body,source);
    }
  }catch(first){
    if(source.kind!=='rss')throw first;
    // Un second essai avec un navigateur ordinaire; aucun contournement de CAPTCHA.
    try{
      response=await download(source.url,source,{...headers,'User-Agent':'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'},fetcher);
      if(!response.notModified){
        if(!/xml/i.test(response.type))throw new Error('RSS: Content-Type non XML.');
        parsedItems=parseRss(response.body,source);
      }
    }catch(second){throw new Error(`${first.message} Second essai: ${second.message}`);}
  }
  if(response.notModified){
    if(!previous.items?.length)throw new Error('HTTP 304 sans cache.');
    const filtered=importantItems(key,previous.items);
    const result=key==='belgium'?await completeBelgium(filtered,previous,fetcher,now):{items:filtered};
    return {...result,etag:previous.etag,lastModified:previous.lastModified};
  }
  if(source.kind==='rss'){
    const filtered=importantItems(key,parsedItems);
    const result=key==='belgium'?await completeBelgium(filtered,previous,fetcher,now):{items:filtered};
    return {...result,etag:response.etag,lastModified:response.lastModified};
  }
  const items=[],visited=new Set();let page=response;
  for(let count=0;count<4;count++){
    if(!/json/i.test(page.type))throw new Error('INASTI: Content-Type non JSON.');
    const parsed=parseInasti(page.body);items.push(...parsed.items);
    if(!parsed.next)break;
    const next=new URL(parsed.next);
    if(next.pathname!=='/fr/jsonapi/node/news'||visited.has(next.href))throw new Error('Pagination INASTI inattendue.');
    visited.add(next.href);
    if(count===3)break;
    page=await download(next.href,source,headers,fetcher);
  }
  return {items,etag:null,lastModified:null};
}
export async function refreshSource(key,previous=null,{fetcher=fetch,now=Date.now(),force=false}={}) {
  // Conserver le dernier succes et espacer les echecs jusqu a six heures.
  if(!force&&previous?.nextAttempt>now)return previous;
  const lastAttempt=new Date(now).toISOString();
  try{
    const result=await collect(key,previous||{},fetcher,now);
    if(!result.items.length&&!(key==='fisconetplus'&&result.documentsListed===0))throw new Error('Source sans article exploitable; ancien cache conserve.');
    const previousItems=previous?.items?importantItems(key,previous.items):[];
    const items=key==='fisconetplus'?mergeItems([],result.items,Infinity):result.items===previous?.items&&previousItems===previous.items?previous.items:mergeItems(previousItems,result.items);
    const unchanged=JSON.stringify(items)===JSON.stringify(previous?.items);
    return {...result,items,modifiedAt:unchanged?previous.modifiedAt:lastAttempt,lastAttempt,lastSuccess:lastAttempt,
      error:null,failures:0,nextAttempt:now+(result.documentsPending?600000:3600000)};
  }catch(error){
    const failures=(previous?.failures||0)+1;
    return {...previous,items:previous?.items||[],lastAttempt,error:error.message.slice(0,400),failures,
      nextAttempt:now+Math.min(6,2**Math.min(failures-1,3))*3600000};
  }
}
export function logRefresh(key,state) {
  // Journaliser une erreur lisible sans jamais publier le HTML d une protection anti-bot.
  console[state.error?'error':'log'](JSON.stringify({source:key,items:state.items.length,lastSuccess:state.lastSuccess||null,error:state.error||null,nextAttempt:new Date(state.nextAttempt).toISOString()}));
}
