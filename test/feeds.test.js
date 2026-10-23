/* Programme: Actualites publiques - Tests de collecte et diffusion
   Date: 2026-09-14 - Auteur: nemesiaa
   Execution: npm test. Sources simulees, aucun acces aux sites officiels.
   Les dossiers temporaires sont supprimes apres les tests. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {sources,parseInasti,parseSpf,parseRss,mergeItems,renderRss,validateRss} from '../src/feeds.js';
import {download,collect,refreshSource} from '../src/collect.js';
import {feedResponse,sourceKey} from '../src/http.js';
import {fileStore} from '../src/store.js';
import {createApp} from '../src/server.js';
import worker from '../src/worker.js';
import {cleanContent,extractBelgium} from '../src/content.js';
import {parseSpwIndex,parseSpwRss,extractSpw,readSpwArticle,parseFisconet} from '../src/providers.js';
import {isImportantFeedItem,isImportantFisconetRow} from '../src/importance-filter.js';
import {parseDocument} from 'htmlparser2';
import {findAll,textContent} from 'domutils';
// Sources publiques des deux nouveaux adaptateurs.
const spwIndex=await readFile(new URL('./fixtures/spw-index.html',import.meta.url),'utf8');
const spwArticle=await readFile(new URL('./fixtures/spw-article.html',import.meta.url),'utf8');
// Flux RSS Jahia decouvert apres les premieres sondes.
const spwRss=await readFile(new URL('./fixtures/spw.xml',import.meta.url),'utf8');
const fisconet=await readFile(new URL('./fixtures/fisconetplus.json',import.meta.url),'utf8');
const fisconetChanges=await readFile(new URL('./fixtures/fisconet-changes.json',import.meta.url),'utf8');
// Page officielle comportant quatre sections editoriales.
const article=await readFile(new URL('./fixtures/belgium-article.html',import.meta.url),'utf8');

// Echantillon reel public de l API, conserve pour detecter les regressions.
const api=await readFile(new URL('./fixtures/inasti.json',import.meta.url),'utf8');
// Echantillon reel RSS public, sans cookie ni autre entete prive.
const rss=await readFile(new URL('./fixtures/spf.xml',import.meta.url),'utf8');
// Echantillon officiel des communiques federaux.
const belgium=await readFile(new URL('./fixtures/belgium.xml',import.meta.url),'utf8');
// Horloge fixe pour verifier la stabilite des GUID, dates et validateurs HTTP.
const now=Date.parse('2026-09-14T14:00:00Z');
function mock(body,type='application/rss+xml',status=200,extra={}) {
  // Fabriquer une reponse sans aucun acces reseau.
  return new Response(body,{status,headers:{'content-type':type,...extra}});
}
function state(items) {
  // Simuler une collecte valide deja persistee.
  return {items,modifiedAt:new Date(now).toISOString(),lastSuccess:new Date(now).toISOString(),nextAttempt:0};
}
test('API INASTI: titre, date de publication, resume, langue et UUID',()=>{
  // La date de creation Drupal ne doit pas remplacer celle affichee dans les actualites.
  const result=parseInasti(api);assert.equal(result.items.length,43);
  const first=result.items[0];assert.equal(first.date,'2026-09-01T00:00:00.000Z');
  assert.match(first.link,/^https:\/\/www.inasti.be\/fr\/actualites\//);assert.match(first.id,/urn:inasti:fr:/);
  assert.ok(first.summary);assert.ok(!first.summary.includes('<p>'));
  const changed=JSON.parse(api);changed.data[0].attributes.langcode='nl';assert.equal(parseInasti(JSON.stringify(changed)).items.length,42);
});
test('Changement de schema INASTI et date incoherente refuses',()=>{
  // Conserver le cache si le fournisseur change la structure des champs attendus.
  assert.throws(()=>{ /* Rejeter un HTML de protection. */ parseInasti('<html>CAPTCHA</html>'); });
  const changed=JSON.parse(api);delete changed.data[0].attributes.path;
  assert.throws(()=>{ /* Rejeter un article prive de son lien. */ parseInasti(JSON.stringify(changed)); });
  changed.data[0]=JSON.parse(api).data[0];changed.data[0].attributes.field_publication_date='2026-02-31';
  assert.throws(()=>{ /* Rejeter la normalisation silencieuse d une date impossible. */ parseInasti(JSON.stringify(changed)); });
});
test('SPF RSS officiel: 10 articles et aucune page CAPTCHA acceptee',()=>{
  // Valider le type reel du contenu, meme si HTTP annonce une reussite.
  assert.equal(parseSpf(rss).length,10);
  for(const body of ['<html><body>Verify you are human</body></html>','<!DOCTYPE rss><rss/>','<rss><channel>','<feed/>'])assert.throws(()=>{
    // Refuser les structures ne contenant pas le canal officiel.
    parseSpf(body);
  });
});
test('Doublons et editions: GUID stable, alias actualise, historique conserve',()=>{
  // Fusionner par UUID ou lien, sans multiplier les articles a chaque collecte.
  const original=parseInasti(api).items,updated={...original[0],title:'Titre corrige',link:original[0].link+'-corrige'};
  const merged=mergeItems(original,[updated,...original.slice(1),updated]);assert.equal(merged.length,43);
  assert.equal(merged.find(item=>{ /* Rechercher le meme identifiant officiel. */ return item.id===updated.id; }).title,'Titre corrige');
  assert.equal(mergeItems(original,original).length,43);assert.equal(mergeItems(original,[],20).length,20);
});
test('RSS UTF-8, esperluettes, balises, controles interdits et dates',()=>{
  // Verifier un contenu difficile sans produire de XML casse ni de HTML actif.
  const item={...parseInasti(api).items[0],title:'Échéance & <TVA> 😀\u0001',summary:'A ]]> B & C'};
  const xml=renderRss('inasti',state([item]),'https://rss.example.org');
  assert.deepEqual(validateRss(xml),{valid:true,items:1,duplicateIds:0,duplicateLinks:0});
  assert.ok(xml.includes('Échéance &amp; &lt;TVA&gt; 😀'));assert.ok(!xml.includes('\u0001'));
  assert.throws(()=>{ /* Le validateur doit detecter une repetition du meme article. */ validateRss(renderRss('inasti',state([item,item]),'https://rss.example.org')); });
});
test('Erreur SPF: conserver dernier succes et appliquer un delai de reprise',async()=>{
  // Une protection temporaire ne remplace jamais le RSS par une page HTML.
  const previous=state(parseSpf(rss));let calls=0;
  const broken=await refreshSource('spf-finances',previous,{now,fetcher:async()=>{
    // Simuler HTTP 200 avec page anti-bot.
    calls++;return mock('<html>CAPTCHA</html>','text/html');
  }});
  assert.equal(calls,2);assert.ok(broken.error);assert.deepEqual(broken.items,previous.items);assert.equal(broken.lastSuccess,previous.lastSuccess);
  const skipped=await refreshSource('spf-finances',broken,{now:now+1000,fetcher:async()=>{
    // Verifier que le backoff evite une nouvelle requete.
    assert.fail('Requete prematuree');
  }});assert.equal(skipped,broken);
  const recovered=await refreshSource('spf-finances',broken,{now:broken.nextAttempt,fetcher:async()=>{
    // Retrouver le flux officiel apres la panne.
    return mock(rss);
  }});assert.equal(recovered.error,null);assert.equal(recovered.items.length,10);
});
test('HTTP conditionnel amont et date de modification stable',async()=>{
  // Ne pas annoncer tous les articles comme nouveaux lors d un simple rafraichissement.
  const previous={...state(parseSpf(rss)),etag:'"amont"'};
  const next=await refreshSource('spf-finances',previous,{now:now+3600000,fetcher:async(_url,options)=>{
    // Verifier les validateurs envoyes au SPF.
    assert.equal(options.headers['If-None-Match'],'"amont"');return new Response(null,{status:304});
  }});
  assert.equal(next.modifiedAt,previous.modifiedAt);assert.equal(next.lastSuccess,new Date(now+3600000).toISOString());
});
test('Pagination JSON:API suivie et domaine officiel impose',async()=>{
  // Collecter les pages annoncees par Drupal sans autoriser un proxy arbitraire.
  const a=JSON.parse(api),b=JSON.parse(api);a.data=a.data.slice(0,2);b.data=b.data.slice(2,4);
  a.links={next:{href:'https://www.inasti.be/fr/jsonapi/node/news?page%5Boffset%5D=50'}};b.links={};let calls=0;
  const result=await collect('inasti',{},async()=>{
    // Simuler deux pages distinctes d actualites.
    return mock(JSON.stringify(calls++===0?a:b),'application/vnd.api+json');
  });assert.equal(result.items.length,4);assert.equal(calls,2);
  await assert.rejects(download('https://localhost/private',sources.inasti,{},async()=>{
    // Ne jamais atteindre la couche reseau pour une destination interdite.
    assert.fail('SSRF');
  }));
  await assert.rejects(download(sources.inasti.url,sources.inasti,{},async()=>{
    // Refuser une redirection de la source vers une autre machine.
    return new Response(null,{status:302,headers:{location:'http://127.0.0.1'}});
  }));
});
test('Flux HTTP: HEAD, ETag/304, alias et premier echec 503',async()=>{
  // Controler le protocole attendu par les lecteurs RSS distants.
  const url='https://rss.example.org/rss/inasti.xml',cache=state(parseInasti(api).items);
  const response=await feedResponse(new Request(url),'inasti',cache);assert.equal(response.status,200);
  validateRss(await response.text());assert.match(response.headers.get('content-type'),/utf-8/);
  const conditional=await feedResponse(new Request(url,{headers:{'If-None-Match':response.headers.get('etag')}}),'inasti',cache);assert.equal(conditional.status,304);
  const head=await feedResponse(new Request(url,{method:'HEAD'}),'inasti',cache);assert.equal(await head.text(),'');
  assert.equal((await feedResponse(new Request(url),'inasti',null)).status,503);
  assert.equal(sourceKey('/inasti.xml'),'inasti');assert.equal(sourceKey('/rss/spf-finances.xml'),'spf-finances');assert.equal(sourceKey('/https://evil.test'),null);
});
test('Stockage disque persistant et Express reel sur port temporaire',async(t)=>{
  // Tester un redemarrage de l adaptateur disque et une requete HTTP complete.
  const directory=await mkdtemp(join(tmpdir(),'rss-personnel-test-'));
  t.after(async()=>{ /* Nettoyer le dossier de test seulement. */ await rm(directory,{recursive:true,force:true}); });
  const store=fileStore(directory);await store.put('inasti',state(parseInasti(api).items));
  const restored=fileStore(directory);assert.equal((await restored.get('inasti')).items.length,43);
  const app=createApp(restored,'https://rss.example.org');const server=app.listen(0,'127.0.0.1');
  await new Promise(resolve=>{ /* Attendre l ouverture du port temporaire. */ server.once('listening',resolve); });
  t.after(()=>{ /* Liberer le serveur du test. */ server.close(); });
  const response=await fetch(`http://127.0.0.1:${server.address().port}/rss/inasti.xml`);assert.equal(response.status,200);validateRss(await response.text());
});
test('Worker Cloudflare: lecture KV sans collecte et cache stale diffusable',async()=>{
  // Les visites Inoreader ne consomment pas de requetes sur les sites officiels.
  const cached={...state(parseSpf(rss)),error:'Source HTTP 403.'};
  const env={RSS_CACHE:{get:async(key,type)=>{
    // Simuler la liaison KV sans dependance Cloudflare.
    assert.equal(key,'feed:spf-finances');assert.equal(type,'json');return cached;
  }}};
  const response=await worker.fetch(new Request('https://rss.example.org/spf-finances.xml'),env);
  assert.equal(response.status,200);assert.equal(response.headers.get('x-feed-status'),'stale');validateRss(await response.text());
});
test('Cron Cloudflare: collecte structuree et conservation KV',async(t)=>{
  // Verifier le producteur planifie avec des sources simulees et des ecritures persistantes.
  const saved=new Map(),tasks=[];
  t.mock.method(globalThis,'fetch',async(url)=>{
    // Aucun acces Internet; choisir la fixture selon le domaine officiel.
    if(String(url).includes('finances.wallonie.be')){
      if(String(url).endsWith('.rss'))return mock(spwRss);
      return mock(spwArticle.replace(/(<link rel="canonical" href=")[^"]+/,(_,prefix)=>prefix+String(url)),'text/html');
    }
    if(String(url).includes('/fisconetPlus/public/changes/searches'))return mock('{"data":{"pageContent":[]}}','application/json');
    if(String(url).includes('/fisconetPlus/public/document/'))return mock('{"error":true}','application/json');
    if(String(url).includes('/fisconetPlus/public/news'))return mock(fisconet,'application/json');
    return String(url).includes('inasti.be')?mock(api,'application/vnd.api+json'):String(url).includes('news.belgium.be')?(String(url).includes('/feeds/')?mock(belgium):mock(article,'text/html')):mock(rss);
  });
  const env={RSS_CACHE:{
    async get(key){ /* Simuler un stockage initialement vide. */ return saved.get(key)||null; },
    async put(key,value){ /* Enregistrer la valeur qui survivrait a un redemarrage. */ saved.set(key,key.startsWith('prepared:')?value:JSON.parse(value)); },
  }};
  await worker.scheduled({scheduledTime:now},env,{waitUntil(task){ /* Attendre la fin des taches planifiees. */ tasks.push(task); }});
  await Promise.all(tasks);
  assert.equal(saved.get('feed:inasti').items.length,43);assert.equal(saved.get('feed:spf-finances').items.length,10);
  assert.equal(saved.get('feed:spw-finances').items.length,12);assert.equal(saved.get('feed:fisconetplus').items.length,4);
  assert.equal(saved.get('feed:belgium').items.length,1);assert.equal(saved.get('feed:belgium').error,null);
  assert.equal(saved.get('feed:inasti').error,null);assert.equal(saved.get('feed:spf-finances').nextAttempt,now+3600000);
});
test('Collecte manuelle Cloudflare inaccessible sans secret serveur',async()=>{
  // Un lecteur public ne doit pas pouvoir declencher les requetes officielles.
  const env={REFRESH_TOKEN:'secret-de-test',RSS_CACHE:{get:async()=>{
    // Une requete non autorisee ne doit meme pas acceder au cache.
    assert.fail('Acces non autorise');
  }}};
  for(const headers of [{},{authorization:'Bearer incorrect'}]){
    const response=await worker.fetch(new Request('https://rss.example.org/admin/refresh',{method:'POST',headers}),env);
    assert.equal(response.status,404);
  }
});

test('Belgium.be: vrais liens officiels et presentation Amnesian sans cabinet',()=>{
  // Valider la nouvelle source et l absence de marque dans le XML public.
  const items=parseRss(belgium,sources.belgium);assert.equal(items.length,10);
  for(const item of items)assert.ok(item.link.startsWith('https://news.belgium.be/fr/'));
  for(const key of Object.keys(sources)){
    const list=key==='inasti'?parseInasti(api).items:key==='belgium'?items:parseSpf(rss);
    const xml=renderRss(key,state(list),'https://actualites.flux-publics.workers.dev');
    assert.ok(xml.includes('Publié par Amnesian'));assert.ok(!/\blpf(?:\s+consult)?\b/i.test(xml));
    validateRss(xml);
  }
});
test('Relais Belgium.be: envoi authentifie, dedoublonnage et depot controle',async()=>{
  // Verifier tout le parcours du relais sans appeler le reseau ni utiliser un vrai secret.
  const {createBelgiumPublisher}=await import('../src/publisher.js');
  let saved=null,calls=0;
  const current={...state(parseRss(belgium,sources.belgium)),lastSuccess:new Date().toISOString()};
  const env={REFRESH_TOKEN:'test',RSS_CACHE:{
    async get(){ /* Simuler le cache public precedent. */ return saved; },
    async put(_key,value){ /* Conserver la publication pour les assertions. */ saved=JSON.parse(value); },
  }};
  const publish=createBelgiumPublisher({origin:'https://actualites.flux-publics.workers.dev',token:'test',fetcher:async(url,options)=>{
    // Brancher le producteur directement sur le handler du Worker.
    calls++;return worker.fetch(new Request(url,options),env);
  }});
  assert.equal(await publish(current),true);assert.equal(saved.collector,'self-hosted');assert.equal(saved.items.length,1);
  assert.equal(await publish(current),false);assert.equal(calls,1);
  const forbidden=await worker.fetch(new Request('https://actualites.flux-publics.workers.dev/admin/publish-belgium',{method:'POST',body:belgium}),env);
  assert.equal(forbidden.status,404);
});


test('Contenu integral: paragraphes, tableaux, liens absolus et aucune execution HTML',()=>{
  // Les donnees d une source ne doivent pas pouvoir injecter un script dans le lecteur.
  const html=cleanContent('<h2>Details</h2><p onclick="evil()">Texte <a href="/fr/detail">lien</a></p><table><tr><td colspan="2">42</td></tr></table><script>evil()</script><a href="javascript:evil()">interdit</a><img src="/image.jpg" onerror="evil()">','https://www.inasti.be/fr/actualites/test');
  assert.match(html,/<h2>Details<\/h2>/);assert.match(html,/<table>/);assert.match(html,/href="https:\/\/www.inasti.be\/fr\/detail"/);
  assert.ok(!/onclick|onerror|<script|javascript:|<img/.test(html));
  const data=JSON.parse(api);data.data[0].attributes.field_article={processed:html};
  assert.equal(parseInasti(JSON.stringify(data)).items[0].content,html);
});
test('Belgium: toutes les sections et le PDF, sans menu ni pied de page',()=>{
  // L article reel comporte quatre blocs; ne pas garder uniquement le premier.
  const body=extractBelgium(article,'https://news.belgium.be/fr/article');
  assert.equal((body.match(/<h2>/g)||[]).length,4);
  assert.match(body,/Fiche technique/);assert.match(body,/Version PDF officielle/);
  assert.ok(!body.includes('Abonnez-vous à notre newsletter'));
  assert.throws(()=>{ /* Detecter un changement de structure explicite. */ extractBelgium('<main>Structure inconnue</main>','https://news.belgium.be/fr/article'); });
});

test('Belgium: filtre Inoreader sans adjudications de tresorerie',async()=>{
  // Ecarter les communiques financiers repetitifs sans toucher aux autres flux.
  const rows=parseRss(belgium,sources.belgium);
  assert.equal(rows.length,10);
  assert.equal(rows.filter(item=>isImportantFeedItem('belgium',item)).length,1);
  assert.equal(isImportantFeedItem('belgium',{title:"Résultats de l'adjudication OLO du 28 septembre 2026"}),false);
  assert.equal(isImportantFeedItem('belgium',{title:'Report des délais fiscaux pour les entreprises'}),true);
  const result=await collect('belgium',{},async(url)=>{
    // La page de l adjudication ne doit pas etre ouverte apres filtrage.
    if(String(url).includes('/feeds/'))return mock(belgium);
    if(/adjudication|tresorerie/i.test(String(url)))assert.fail('Article bruyant ouvert');
    return mock(article,'text/html');
  });
  assert.equal(result.items.length,1);
});
test('RSS integral et relais: conserver les details et un seul lien source final',()=>{
  // Un aller-retour par le relais ne doit ni reduire le corps ni dupliquer le pied source.
  const item={...parseRss(belgium,sources.belgium)[0],content:'<h2>Details</h2><p>Premier paragraphe.</p><p>Dernier paragraphe.</p>'};
  const first=renderRss('belgium',state([item]),'https://rss.example.org');
  const parsed=parseRss(first,sources.belgium);
  assert.equal(parsed[0].content,item.content);
  const second=renderRss('belgium',state(parsed),'https://rss.example.org');
  assert.equal(first,second);assert.match(first,/<content:encoded>/);validateRss(second);
});
test('Belgium: relecture des corps meme si le flux RSS annonce HTTP 304',async()=>{
  // Une correction du texte peut ne pas modifier le flux abrege; verifier les pages quand meme.
  const item={...parseRss(belgium,sources.belgium).find(row=>isImportantFeedItem('belgium',row)),content:'<p>Ancien texte</p>',contentComplete:true};
  let pages=0;
  const result=await collect('belgium',{...state([item]),etag:'"feed"'},async(url)=>{
    // Le flux est identique mais le texte de la page a change.
    if(String(url).includes('/feeds/'))return new Response(null,{status:304});
    pages++;return mock(article,'text/html');
  });
  assert.equal(pages,1);assert.match(result.items[0].content,/Fiche technique/);
  const failed=await refreshSource('belgium',state([item]),{now,fetcher:async(url)=>{
    // Une page bloquee ne doit pas ecraser le corps complet par un simple resume.
    return String(url).includes('/feeds/')?mock(belgium):mock('<html>Captcha</html>','text/html');
  }});
  assert.ok(failed.error);assert.equal(failed.items[0].content,item.content);
});


test('SPW: date officielle, corps entier et listes conservees',()=>{
  // La liste de cartes ne doit pas etre confondue avec le corps des articles.
  const items=parseSpwIndex(spwIndex);assert.equal(items.length,12);assert.equal(items[0].date,'2026-08-05T00:00:00.000Z');
  const content=extractSpw(spwArticle,items[0].link);
  assert.match(content,/Quand vais-je recevoir/);assert.match(content,/revers/);assert.match(content,/<ul>/);assert.match(content,/<li>/);
  assert.ok(!content.includes('spw_button_email'));
  assert.throws(()=>{ /* Detecter une modification du schema. */ parseSpwIndex('<main>Aucune carte</main>'); });
});
test('Fisconetplus: API publique francaise, corps et destinations officielles',async()=>{
  // Verifier les entetes réellement utilises par MyMinfin sans cookies ni authentification.
  const items=parseFisconet(fisconet);assert.equal(items.length,5);assert.equal(new Set(items.map(x=>x.link)).size,5);
  assert.match(items[0].content,/Bonne lecture/);assert.match(items[0].link,/^https:\/\/www.minfin.fgov.be\/myminfin-web\/pages\/public\/fisconet\//);
  const result=await collect('fisconetplus',{},async(url,options)=>{
    // Une absence de fragmentid renvoie une liste vide sur le vrai serveur.
    assert.equal(options.headers.fragmentid,'fisconetplus');assert.equal(options.headers['Accept-Language'],'fr');assert.equal(options.headers.Cookie,undefined);
    if(String(url).includes('/changes/searches'))return mock('{"data":{"pageContent":[]}}','application/json');
    if(String(url).includes('/document/'))return mock('{"error":true}','application/json');
    return mock(fisconet,'application/json');
  });assert.equal(result.items.length,4);
  assert.throws(()=>{ /* Une fausse reussite vide ne doit pas remplacer le cache. */ parseFisconet('{"data":[],"error":false}'); });
});
test('INASTI: les neuf prestations a puces restent presentes dans les deux champs RSS',async()=>{
  // Cas exact signale dans Inoreader; verifier toutes les puces et pas seulement le premier paragraphe.
  const html=await readFile(new URL('./fixtures/inasti-article-list.html',import.meta.url),'utf8');
  const document=parseDocument(html),field=findAll(n=>(n.attribs?.class||'').includes('block-field-blocknodenewsfield-article'),document.children)[0];
  assert.ok(field);
  const {getInnerHTML}=await import('domutils');
  const original=findAll(n=>n.name==='li',field.children).map(textContent);
  assert.equal(original.length,9);
  const item={...parseInasti(api).items[0],content:cleanContent(getInnerHTML(field),'https://www.inasti.be')};
  const xml=renderRss('inasti',state([item]),'https://rss.example.org');
  const {XMLParser}=await import('fast-xml-parser');const row=new XMLParser().parse(xml).rss.channel.item;
  for(const body of [row.description,row['content:encoded']]){
    const actual=findAll(n=>n.name==='li',parseDocument(body).children).map(textContent);
    assert.deepEqual(actual,original);
  }
});
test('Adresse complete distincte: contenu identique et lien atom self correct',async()=>{
  // Une nouvelle souscription doit annoncer sa propre URL sans modifier les identifiants des articles.
  const cache=state(parseSpf(rss));
  const response=await feedResponse(new Request('https://rss.example.org/rss/spf-finances-complet.xml'),'spf-finances',cache);
  const xml=await response.text();assert.match(xml,/href="https:\/\/rss.example.org\/rss\/spf-finances-complet.xml"/);
  assert.equal(sourceKey('/rss/inasti-complet.xml'),'inasti');assert.equal(sourceKey('/rss/spw-finances-complet.xml'),'spw-finances');
  assert.equal(parseRss(xml,sources['spf-finances'])[0].id,cache.items[0].id);
});


test('SPW RSS cache: dates tirees des pages et canonical dedoublonne',async()=>{
  // La date RSS de cette reduction est mars alors que la publication affichee est juin.
  const items=parseSpwRss(spwRss);assert.equal(items.length,12);
  assert.ok(items[0].sourceLink.includes('/cms/render/live/'));
  const html=await readFile(new URL('./fixtures/spw-corrected-date.html',import.meta.url),'utf8');
  const article=readSpwArticle(html,items[3].link);
  assert.equal(article.date,'2026-06-23T00:00:00.000Z');assert.match(article.link,/\/actualite\/reduction-/);
  assert.equal(article.id,article.link);assert.ok(!article.link.includes('/cms/render/'));
});
test('SPW: ancien gabarit newsText et sa date affichée',async()=>{
  // Le RSS officiel contient aussi des annonces non presentes dans les cartes de la premiere page.
  const html=await readFile(new URL('./fixtures/spw-news-article.html',import.meta.url),'utf8');
  const article=readSpwArticle(html,'https://finances.wallonie.be/news/article');
  assert.equal(article.date,'2026-07-07T00:00:00.000Z');assert.match(article.content,/formulaire papier/);
  assert.ok(!article.content.includes('Retour à la liste'));
});

test('Fisconetplus: toutes les matieres, derniere version et corps reel de la circulaire',async()=>{
  // Le cas reel possede quatre sections, des tableaux et des annexes apres l introduction.
  const {changes,documentItem}=await import('../src/fisconet.js');
  const rows=changes(await readFile(new URL('./fixtures/fisconet-changes.json',import.meta.url),'utf8'));
  assert.equal(rows.length,229);assert.equal(new Set(rows.map(row=>row.taxonomyTerm)).size,16);
  assert.equal(rows.find(row=>row.guid==='b8eaa8de-62af-46ba-9621-b57c9d92e81b').version,'3.0');
  const row=rows.find(row=>row.guid==='a188c5af-8bf6-4c31-beae-cd6e92c3a8de');
  const body=await readFile(new URL('./fixtures/fisconet-document.json',import.meta.url),'utf8');
  const item=documentItem(body,row);
  assert.equal(item.contentComplete,true);assert.match(item.content,/742\.989\/8/);assert.match(item.content,/classe d'exactitude B/);
  assert.match(item.content,/<table/);assert.match(item.content,/<h3>Documents connexes et annexes/);
  const xml=renderRss('fisconetplus',{items:[item],modifiedAt:item.date},'https://example.org');
  assert.equal(validateRss(xml).items,1);assert.match(xml,/742\.989\/8/);
  assert.equal(validateRss(renderRss('fisconetplus',{items:[{...item,content:'<p>Texte \u000b ]]> complet</p>'}],modifiedAt:item.date},'https://example.org')).items,1);assert.match(xml,/<content:encoded><!\[CDATA\[/);
  const pdf=JSON.parse(body);pdf.data.content={type:'PDF',content:'JVBERg=='};
  assert.equal(documentItem(JSON.stringify(pdf),row).contentComplete,false);
  const invalid=JSON.parse(body);invalid.data.metadata.guid='incorrect';
  assert.throws(()=>{ /* Refuser un document qui ne correspond pas a la reference. */ documentItem(JSON.stringify(invalid),row); });
});

test('Fisconetplus: filtre Inoreader sans jurisprudence de masse',()=>{
  // Ne garder que les sujets fiscaux pratiques pour le lecteur RSS personnel.
  const rows=JSON.parse(fisconetChanges).data.pageContent;
  assert.equal(isImportantFisconetRow(rows.find(row=>row.title.includes('tribunal de première instance'))),false);
  assert.equal(isImportantFisconetRow(rows.find(row=>row.title.includes('Cour de Justice Européenne'))),false);
  assert.equal(isImportantFisconetRow(rows.find(row=>row.title.includes('Circulaire 2026/C/86'))),true);
  assert.equal(isImportantFisconetRow({title:"Déclaration d'import : délai reporté",summary:'Formulaire temporairement indisponible pour les entreprises.',taxonomyTerm:'Douanes',documentType:'Informations et communications'}),true);
  assert.equal(isImportantFisconetRow({title:"Résultats d'adjudications de la ville",summary:'Marché public attribué.',taxonomyTerm:'Entités fédérées',documentType:'Avis'}),false);
  assert.equal(isImportantFeedItem('spf-finances',{title:'Actualite SPF'}),true);
});

test('Fisconetplus: lots, panne partielle, reprise et cache sans nouvelle lecture du corps',async()=>{
  // Un document en erreur ne bloque pas les suivants et reste en attente pour le prochain passage.
  const {collectDocuments}=await import('../src/fisconet.js');
  const original=JSON.parse(await readFile(new URL('./fixtures/fisconet-document.json',import.meta.url),'utf8'));
  const rows=Array.from({length:12},(_,index)=>{ /* Fabriquer douze references distinctes avec un corps public representatif. */ return {guid:`00000000-0000-0000-0000-${String(index).padStart(12,'0')}`,title:`Circulaire fiscale ${index}`,summary:'Modification importante pour les entreprises.',taxonomyTerm:'Impôts sur les revenus',documentType:'Circulaires',date:'2026-09-14',version:'1.0',language:'fr'}; });
  let failed=true,calls=0;
  const get=async url=>{
    // Simuler seulement l API, sans acceder au site officiel pendant les tests.
    if(url.endsWith('/news'))return fisconet;
    if(url.includes('/changes/'))return JSON.stringify({data:{pageContent:rows}});
    const guid=url.split('/').at(-1);calls++;
    if(guid===rows[0].guid&&failed)throw new Error('Panne temporaire');
    const copy=structuredClone(original);copy.data.metadata.guid=guid;return JSON.stringify(copy);
  };
  const first=await collectDocuments({},get,Date.parse('2026-09-14'));
  assert.equal(calls,10);assert.equal(first.documentErrors.length,1);assert.ok(first.documentsPending>0);
  failed=false;const second=await collectDocuments(first,get,Date.parse('2026-09-14'));
  assert.equal(second.documentsPending,0);const before=calls;
  const third=await collectDocuments(second,get,Date.parse('2026-09-14'));
  assert.equal(calls,before);assert.equal(new Set(third.items.map(item=>item.link)).size,third.items.length);
});

test('Fisconetplus prepare: ETag faible apres compression, HEAD et lecture en streaming',async()=>{
  // Cloudflare peut prefixer W/ apres compression; le lecteur doit encore recevoir 304.
  const env={RSS_CACHE:{getWithMetadata:async()=>{
    // Fournir un flux jetable par requete, comme le stockage KV.
    return {value:new Response('<rss/>').body,metadata:{modifiedAt:'2026-09-14T12:00:00Z'}};
  }}};
  const url='https://example.org/rss/fisconetplus.xml';
  const first=await worker.fetch(new Request(url),env);assert.equal(first.status,200);assert.equal(await first.text(),'<rss/>');
  const cached=await worker.fetch(new Request(url,{headers:{'If-None-Match':'W/'+first.headers.get('etag')}}),env);assert.equal(cached.status,304);
  const head=await worker.fetch(new Request(url,{method:'HEAD'}),env);assert.equal(await head.text(),'');
});
