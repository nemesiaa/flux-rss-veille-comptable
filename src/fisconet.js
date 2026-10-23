/* Programme: Actualites publiques - Documents Fisconetplus
   Date: 2026-09-14 - Auteur: nemesiaa
   Execution automatique via npm start, npm run refresh et le cron Cloudflare.
   Produit les articles de data/fisconetplus.json ou du cache RSS_CACHE.
   Voir README.md: collecte mensuelle, lots, documents PDF et erreurs partielles. */
import {parseFisconet} from './providers.js';
import {cleanContent} from './content.js';
import {escapeXml} from './feeds.js';
import {isImportantFeedItem,isImportantFisconetRow} from './importance-filter.js';
// API publique observee dans les appels reseau de MyMinfin.
const api='https://www.minfin.fgov.be/myminfin-rest/fisconetPlus/public';
// Adresses publiques des documents, sans connexion ni identifiants personnels.
const site='https://www.minfin.fgov.be/myminfin-web/pages/public/fisconet/document/';

export function changes(body) {
  // Dedupliquer les versions d un meme document et garder la plus recente.
  const response=JSON.parse(body),rows=response.data?.pageContent;
  if(response.error||response.sessionExpired||response.mustRedirectToHome||!Array.isArray(rows))throw new Error('Fisconetplus: liste des modifications indisponible.');
  const unique=new Map();
  for(const row of rows){
    if(row.language!=='fr')continue;
    if(!/^[a-f0-9-]{36}$/i.test(row.guid)||!row.title||!/^\d{4}-\d{2}-\d{2}$/.test(row.date)||!Number.isFinite(Date.parse(row.date)))throw new Error('Fisconetplus: reference documentaire invalide.');
    const old=unique.get(row.guid);
    if(!old||row.date>old.date||(row.date===old.date&&Number(row.version)>Number(old.version)))unique.set(row.guid,row);
  }
  return [...unique.values()].sort((a,b)=>{ /* Ordonner par date puis identifiant stable. */ return b.date.localeCompare(a.date)||a.guid.localeCompare(b.guid); });
}
export function documentItem(body,row) {
  // Decoder le HTML officiel UTF-8 en base64, jamais uniquement le resume de la recherche.
  const response=JSON.parse(body),data=response.data,metadata=data?.metadata;
  if(response.error||response.sessionExpired||response.mustRedirectToHome||metadata?.guid!==row.guid||metadata.language!=='fr'||!data.content)throw new Error('Fisconetplus: document indisponible ou identite incorrecte.');
  const link=site+row.guid,type=data.content.type;
  let content;
  if(type==='HTML'){
    const bytes=Uint8Array.from(atob(data.content.content),character=>{ /* Convertir les octets sans perdre les accents. */ return character.charCodeAt(0); });
    const html=new TextDecoder('utf-8',{fatal:true}).decode(bytes).replace(/<title\b[^>]*>[\s\S]*?<\/title>/gi,'');
    content=cleanContent(html,link);
    if(!content.replace(/<[^>]*>/g,'').trim())throw new Error('Fisconetplus: corps HTML vide.');
  }else if(type==='PDF'){
    content=`<p><strong>Document officiel au format PDF.</strong> Le texte de ce PDF n’est pas retranscrit dans le flux.</p><p>${escapeXml(metadata.summary||row.summary||'')}</p><p><a href="${link}">Consulter le document PDF intégral sur Fisconetplus</a></p>`;
  }else throw new Error(`Fisconetplus: format documentaire non pris en charge (${type}).`);
  const related=(metadata.relatedDocuments||[]).filter(document=>{ /* Ne lier que les UUID documentaires publics. */ return /^[a-f0-9-]{36}$/i.test(document.guid); });
  if(related.length)content+='<h3>Documents connexes et annexes</h3><ul>'+related.map(document=>{ /* Conserver toutes les annexes indiquees par les metadonnees. */ return `<li><a href="${site}${document.guid}">${escapeXml(document.title||'Document connexe')}</a></li>`; }).join('')+'</ul>';
  return {id:`urn:fisconetplus:document:${row.guid}`,guid:row.guid,link,title:metadata.title||row.title,date:new Date(row.date+'T00:00:00Z').toISOString(),summary:metadata.summary||row.summary||'',content,contentComplete:type==='HTML',documentFormat:type,documentVersion:row.version,changeDate:row.date,taxonomy:row.taxonomyTerm};
}
export async function collectDocuments(previous,get,now) {
  // Surveiller toutes les matieres du mois courant, et reprendre les references encore en attente du mois precedent.
  const date=new Date(now),month=`${date.getUTCFullYear()}-${String(date.getUTCMonth()+1).padStart(2,'0')}`;
  const response=await get(`${api}/changes/searches?language=fr&month=${date.getUTCMonth()+1}&year=${date.getUTCFullYear()}`);
  const announcements=parseFisconet(await get(`${api}/news`)).filter(item=>isImportantFeedItem('fisconetplus',item));
  const current=changes(response),filtered=current.filter(isImportantFisconetRow),byId=new Map(filtered.map(row=>{ /* Indexer les references actuelles. */ return [row.guid,row]; }));
  for(const item of announcements){
    const guid=item.link.match(/\/document\/([a-f0-9-]{36})$/i)?.[1];
    if(guid&&!byId.has(guid))byId.set(guid,{guid,title:item.title,date:item.date.slice(0,10),version:`annonce-${item.date}`,language:'fr'});
  }
  for(const row of previous.pendingDocuments||[])if(!byId.has(row.guid))byId.set(row.guid,row);
  const old=new Map((previous.items||[]).filter(item=>{ /* Ignorer les annonces sans corps documentaire. */ return item.guid&&isImportantFeedItem('fisconetplus',item); }).map(item=>{ /* Indexer le cache des documents deja ouverts. */ return [item.guid,item]; }));
  const pending=[...byId.values()].filter(row=>{ /* Ne rouvrir un document que lorsque sa version ou sa date change. */ const item=old.get(row.guid);return !item||item.documentVersion!==row.version||item.changeDate!==row.date; });
  pending.sort((a,b)=>{ /* Reessayer les erreurs apres les autres references, meme entre deux executions. */ return Number(previous.documentErrors?.some(error=>error.guid===a.guid)||false)-Number(previous.documentErrors?.some(error=>error.guid===b.guid)||false); });
  const items=[],errors=[],remaining=[];
  // Dix documents par execution maintiennent les appels sous le quota gratuit avec les autres sources.
  for(const [index,row] of pending.entries()){
    if(index>=10){remaining.push(row);continue;}
    try{items.push(documentItem(await get(`${api}/document/${row.guid}`),row));}
    catch(error){errors.push({guid:row.guid,title:row.title,error:error.message});remaining.push(row);}
  }
  // Les erreurs passent en fin de file pour ne pas bloquer les autres documents.
  remaining.sort((a,b)=>{ /* Prioriser les references non tentees dans ce lot. */ return Number(errors.some(error=>error.guid===a.guid))-Number(errors.some(error=>error.guid===b.guid)); });
  const cutoff=now-62*86400000;
  const merged=new Map([...old.values(),...items].filter(item=>{ /* Conserver deux mois glissants de documents, sans couper leur contenu. */ return Date.parse(item.date)>=cutoff||byId.has(item.guid); }).map(item=>{ /* Une seule entree RSS par document, meme apres une modification. */ return [item.guid,item]; }));
  const notices=announcements.filter(item=>{ /* Conserver les annonces de dossiers sans dupliquer leurs documents recuperes. */ return !merged.has(item.link.split('/').at(-1)); });
  return {items:[...merged.values(),...notices].filter(item=>isImportantFeedItem('fisconetplus',item)),pendingDocuments:remaining,documentErrors:errors,coverageMonth:month,documentsListed:filtered.length,documentsScanned:current.length,documentsPending:remaining.length,pdfDocuments:[...merged.values()].filter(item=>{ /* Rendre les exceptions PDF visibles dans le diagnostic. */ return item.documentFormat==='PDF'; }).length,etag:null,lastModified:null};
}
