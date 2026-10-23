/* Programme: Actualites publiques - Verification des deux URLs de diffusion
   Date: 2026-09-14 - Auteur: nemesiaa
   Execution: npm run verify -- https://actualites.<compte>.workers.dev
   Sans argument: serveur http://127.0.0.1:3190. Aucun fichier produit.
   Verifie HTTP, Content-Type, XML RSS, doublons, HEAD et ETag/304. */
import assert from 'node:assert/strict';
import {sources,validateRss} from './feeds.js';
// Origine a verifier, independante de toute authentification Inoreader.
const base=process.argv[2]||'http://127.0.0.1:3190';
for(const key of Object.keys(sources)){
  const url=new URL(`/rss/${key}.xml`,base),headers={'User-Agent':'Inoreader/1.0 (+http://www.inoreader.com/feed-fetcher; 1 subscribers; )'};
  const response=await fetch(url,{headers,signal:AbortSignal.timeout(20000)});
  assert.equal(response.status,200);assert.match(response.headers.get('content-type'),/application\/rss\+xml.*utf-8/i);
  const result=validateRss(await response.text());assert.ok(result.items>0);
  const conditional=await fetch(url,{headers:{...headers,'If-None-Match':response.headers.get('etag')}});assert.equal(conditional.status,304);
  const head=await fetch(url,{method:'HEAD',headers});assert.equal(head.status,200);assert.equal(await head.text(),'');
  const alias=await fetch(new URL(`/${key}.xml`,base),{headers});assert.equal(alias.status,200);validateRss(await alias.text());
  console.log(JSON.stringify({url:url.href,...result,conditional:304,head:200,alias:200,status:response.headers.get('x-feed-status')}));
}
