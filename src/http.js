/* Programme: Actualites publiques - Reponses HTTP communes a Express et Cloudflare
   Date: 2026-09-14 - Auteur: nemesiaa */
import {sources,renderRss,escapeXml} from './feeds.js';

export function readerResponse(key,state) {
  // Montrer le meme contenu que le RSS pour verifier l affichage sans le cache du lecteur.
  if(!state?.items?.length)return new Response('Contenu pas encore disponible',{status:503});
  const articles=state.items.map((item,index)=>{
    // Le contenu du cache a ete nettoye lors de la collecte; titres et URL restent encodes.
    return `<article id="article-${index}"><h2>${escapeXml(item.title)}</h2><p class="date">${escapeXml(item.date?.slice(0,10)||'')}</p>${item.content||`<p>${escapeXml(item.summary)}</p>`}<p class="source">Source officielle : <a href="${escapeXml(item.link)}">${escapeXml(item.link)}</a></p></article>`;
  }).join('\n');
  const html=`<!doctype html><html lang="fr"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeXml(sources[key].title)}</title><style>body{margin:0;background:#f5f6f8;color:#202c3c;font:17px/1.65 system-ui,sans-serif}main{max-width:850px;margin:auto;padding:32px 20px}article{background:white;border:1px solid #dfe5ec;border-radius:12px;padding:28px;margin:28px 0}h1,h2,h3{line-height:1.25}li{margin:.45em 0}ul,ol{padding-left:1.8em}table{border-collapse:collapse;display:block;overflow:auto}td,th{border:1px solid #ccd4df;padding:8px}a{color:#155bb1;overflow-wrap:anywhere}.date,.source{font-size:14px;color:#526073}.source{border-top:1px solid #dfe5ec;padding-top:16px}</style><main><h1>${escapeXml(sources[key].title)}</h1><p>Publié par Amnesian · Lecture du contenu actuellement diffusé dans le flux.</p><a href="/rss/${key}-complet.xml">S’abonner au flux complet</a>${articles}</main></html>`;
  return new Response(html,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'",'X-Content-Type-Options':'nosniff'}});
}

export function sourceKey(pathname) {
  // Accepter les deux chemins stables demandes, sans proxy a URL arbitraire.
  const match=pathname.match(/^\/(?:rss\/)?([a-z-]+)\.xml$/);
  const key=match?.[1]?.replace(/-complet$/,'');
  return key&&Object.hasOwn(sources,key)?key:null;
}
export async function feedResponse(request,key,state) {
  // Servir le dernier RSS valide meme pendant une panne en amont.
  if(!state?.items?.length)return new Response('Flux temporairement indisponible : premiere collecte non reussie.\n',{status:503,headers:{'Content-Type':'text/plain; charset=utf-8','Retry-After':'3600'}});
  const url=new URL(request.url),xml=renderRss(key,state,url.origin,url.pathname);
  const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(xml));
  const etag=`"${Array.from(new Uint8Array(hash)).map(byte=>{
    // Encoder le condensat de contenu pour les requetes conditionnelles.
    return byte.toString(16).padStart(2,'0');
  }).join('')}"`;
  const stale=Boolean(state.error)||Date.now()-Date.parse(state.lastSuccess)>7200000;
  const headers={'Content-Type':'application/rss+xml; charset=utf-8','Cache-Control':'public, max-age=300',
    'ETag':etag,'Last-Modified':new Date(state.modifiedAt).toUTCString(),'X-Content-Type-Options':'nosniff',
    'X-Feed-Status':stale?'stale':'fresh','X-Feed-Last-Success':state.lastSuccess};
  const matches=request.headers.get('if-none-match')?.split(',').map(value=>{
    // Accepter aussi les validateurs faibles fournis par les lecteurs RSS.
    return value.trim().replace(/^W\//,'');
  });
  if(matches?.includes(etag)||matches?.includes('*'))return new Response(null,{status:304,headers});
  return new Response(request.method==='HEAD'?null:xml,{status:200,headers});
}
export function statusResponse(states,origin) {
  // Exposer uniquement la sante des sources publiques, sans parametres prives.
  const report=Object.fromEntries(Object.keys(sources).map(key=>{
    // Indiquer fraicheur, historique et erreur de chaque source independamment.
    const state=states[key];return [key,{url:`${origin}/rss/${key}.xml`,items:state?.items?.length||0,lastSuccess:state?.lastSuccess||null,lastAttempt:state?.lastAttempt||null,error:state?.error||null,collector:state?.collector||'cloudflare',...(key==='fisconetplus'?{coverageMonth:state?.coverageMonth,documentsListed:state?.documentsListed,documentsPending:state?.documentsPending,pdfDocuments:state?.pdfDocuments,documentErrors:state?.documentErrors||[]}: {})}];
  }));
  return Response.json(report,{status:Object.values(report).every(row=>{
    // Une premiere collecte manquante rend le service non pret.
    return row.items>0;
  })?200:503,headers:{'Cache-Control':'no-store'}});
}
