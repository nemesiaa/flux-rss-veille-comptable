/* Programme: Actualites publiques - Hebergement Cloudflare gratuit
   Date: 2026-09-14 - Auteur: nemesiaa
   Deploiement: npm run cloud:deploy apres creation du stockage RSS_CACHE.
   Produit cinq flux publics; les collectes horaires ecrivent uniquement dans Workers KV. */
import {sources,parseRss,mergeItems,renderRss} from './feeds.js';
import {refreshSource,logRefresh} from './collect.js';
import {sourceKey,feedResponse,statusResponse,readerResponse} from './http.js';
import {isImportantFeedItem} from './importance-filter.js';

export async function refreshAll(env,options={}) {
  // Partager la meme collecte entre cron et verification manuelle authentifiee.
  return Promise.all(Object.keys(sources).map(async key=>{
    // Une erreur de source conserve son dernier cache valide.
    const previous=await env.RSS_CACHE.get(`feed:${key}`,'json');
    // Le relais devient le seul producteur Belgium pour eviter les collectes bloquees et les ecritures concurrentes.
    if(key==='belgium'&&previous?.collector==='self-hosted')return {source:key,items:previous.items.length,lastSuccess:previous.lastSuccess,error:previous.error||null,collector:'self-hosted'};
    const state=await refreshSource(key,previous,options);
    if(key==='fisconetplus'&&state.items.length&&state.modifiedAt!==previous?.modifiedAt){
      // Precalculer le gros flux pour que les abonnements ne consomment pas de CPU de rendu.
      for(const suffix of ['', '-complet']){
        const xml=renderRss(key,state,'https://actualites.flux-publics.workers.dev',`/rss/${key}${suffix}.xml`);
        await env.RSS_CACHE.put(`prepared:${key}${suffix}`,xml,{metadata:{modifiedAt:state.modifiedAt}});
      }
      await env.RSS_CACHE.put('prepared:reader-fisconetplus',await readerResponse(key,state).text());
    }
    if(state!==previous)await env.RSS_CACHE.put(`feed:${key}`,JSON.stringify(state));
    logRefresh(key,state);
    return {source:key,items:state.items.length,lastSuccess:state.lastSuccess||null,error:state.error||null};
  }));
}

export default {
  async fetch(request,env) {
    // Les consultations ne declenchent aucune requete vers les organismes officiels.
    try{
      const url=new URL(request.url);
      if(url.pathname==='/admin/publish-belgium'){
        // Accepter uniquement les donnees officielles du relais personnel authentifie.
        if(request.method!=='POST'||!env.REFRESH_TOKEN||request.headers.get('authorization')!==`Bearer ${env.REFRESH_TOKEN}`)return new Response('Introuvable',{status:404});
        const body=await request.text(),collectedAt=request.headers.get('x-collected-at');
        const timestamp=Date.parse(collectedAt);
        if(body.length>2_000_000||!Number.isFinite(timestamp)||timestamp>Date.now()+300000||timestamp<Date.now()-7200000)return new Response('Depot invalide',{status:400});
        const incoming=parseRss(body,sources.belgium).filter(item=>isImportantFeedItem('belgium',item));
        if(!incoming.length)return new Response('Flux vide refuse',{status:400});
        const previous=await env.RSS_CACHE.get('feed:belgium','json');
        if(previous?.lastSuccess&&Date.parse(previous.lastSuccess)>timestamp)return Response.json({accepted:false,reason:'Cache plus recent'});
        const items=mergeItems((previous?.items||[]).filter(item=>isImportantFeedItem('belgium',item)),incoming);
        const state={items,modifiedAt:JSON.stringify(items)===JSON.stringify(previous?.items)?previous.modifiedAt:collectedAt,
          lastAttempt:collectedAt,lastSuccess:collectedAt,error:null,failures:0,nextAttempt:timestamp+3600000,collector:'self-hosted'};
        await env.RSS_CACHE.put('feed:belgium',JSON.stringify(state));
        return Response.json({accepted:true,items:items.length,lastSuccess:collectedAt},{headers:{'Cache-Control':'no-store'}});
      }
      if(url.pathname==='/admin/refresh'){
        // Seul un secret serveur distinct peut declencher une collecte manuelle.
        if(request.method!=='POST'||!env.REFRESH_TOKEN||request.headers.get('authorization')!==`Bearer ${env.REFRESH_TOKEN}`)return new Response('Introuvable',{status:404});
        const results=await refreshAll(env,{force:true});
        return Response.json(results,{status:results.some(result=>{ /* Signaler les echecs au script de verification. */ return result.error; })?502:200,headers:{'Cache-Control':'no-store'}});
      }
      if(!['GET','HEAD'].includes(request.method))return new Response('Methode non autorisee',{status:405,headers:{Allow:'GET, HEAD'}});
      const preparedKey=sourceKey(url.pathname);
      if(preparedKey==='fisconetplus'&&env.RSS_CACHE.getWithMetadata){
        // Lire directement le XML prepare sous forme de flux, sans parser les megabytes du cache JSON.
        const cached=await env.RSS_CACHE.getWithMetadata(`prepared:fisconetplus${url.pathname.includes('-complet')?'-complet':''}`,'stream');
        if(cached.value){
          const etag=`"fisco-${cached.metadata.modifiedAt}-${url.pathname.includes('-complet')}"`;
          const headers={'Content-Type':'application/rss+xml; charset=utf-8','Cache-Control':'public, max-age=300',ETag:etag,'Last-Modified':new Date(cached.metadata.modifiedAt).toUTCString(),'X-Content-Type-Options':'nosniff'};
          if(request.headers.get('if-none-match')?.split(',').some(value=>{ /* Accepter les ETag affaiblis par la compression HTTP. */ return value.trim().replace(/^W\//,'')===etag||value.trim()==='*'; })){await cached.value.cancel();return new Response(null,{status:304,headers});}
          if(request.method==='HEAD'){await cached.value.cancel();return new Response(null,{headers});}
          return new Response(cached.value,{headers});
        }
      }
      if(url.pathname==='/lire/fisconetplus'){
        const html=await env.RSS_CACHE.get('prepared:reader-fisconetplus','stream');
        if(html)return new Response(request.method==='HEAD'?null:html,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"}});
      }
      const readerKey=url.pathname.startsWith('/lire/')?sourceKey(`/rss/${url.pathname.slice(6)}.xml`):null;
      if(readerKey){
        const response=readerResponse(readerKey,await env.RSS_CACHE.get(`feed:${readerKey}`,'json'));
        return request.method==='HEAD'?new Response(null,{status:response.status,headers:response.headers}):response;
      }
      const key=sourceKey(url.pathname);
      if(key)return feedResponse(request,key,await env.RSS_CACHE.get(`feed:${key}`,'json'));
      if(url.pathname==='/'||url.pathname==='/health'){
        const states={};
        for(const id of Object.keys(sources))states[id]=await env.RSS_CACHE.get(`feed:${id}`,'json');
        const response=statusResponse(states,url.origin);
        return request.method==='HEAD'?new Response(null,{status:response.status,headers:response.headers}):response;
      }
      return new Response('Flux inconnu',{status:404});
    }catch(error){console.error('Lecture du cache RSS impossible:',error.message);return new Response('Cache temporairement indisponible',{status:503,headers:{'Retry-After':'300'}});}
  },
  async scheduled(_event,env,ctx) {
    // Un seul producteur horaire; KV persiste entre executions et redemarrages.
    ctx.waitUntil(refreshAll(env,{now:_event.scheduledTime||Date.now()}));
  },
};
