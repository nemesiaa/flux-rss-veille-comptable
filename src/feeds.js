/* Programme: Actualites publiques - Sources structurees et generation RSS 2.0
   Date: 2026-09-14 - Auteur: nemesiaa
   Module partage Node/Cloudflare, sans acces disque ni execution de HTML. */
import {XMLParser, XMLValidator} from 'fast-xml-parser';
import {decodeHTML} from 'entities';
import {cleanContent} from './content.js';

// Champs publics necessaires; inclure le corps integral sans revisions ni relations inutiles.
const api = new URL('https://www.inasti.be/fr/jsonapi/node/news');
for (const [key,value] of Object.entries({
  'filter[status]':'1', sort:'-field_publication_date,-created', 'page[limit]':'50',
  'fields[node--news]':'title,langcode,status,path,field_publication_date,field_teaser,field_article,created,changed,drupal_internal__nid',
})) api.searchParams.set(key,value);
// Registre extensible: seuls ces organismes peuvent etre contactes par le service.
export const sources = {
  inasti:{title:'INASTI — Actualités', site:'https://www.inasti.be/fr/actualites', url:api.href, host:'www.inasti.be', kind:'jsonapi'},
  belgium:{title:'Belgium.be — Communiqués fédéraux', site:'https://news.belgium.be/fr', url:'https://news.belgium.be/fr/feeds/all', host:'news.belgium.be', kind:'rss'},
  'spf-finances':{title:'SPF Finances Belgique — Actualités', site:'https://finances.belgium.be/fr/Actualites', url:'https://finances.belgium.be/fr/Actualites/rss.xml', host:'finances.belgium.be', kind:'rss'},
  'spw-finances':{title:'SPW Finances — Actualités',site:'https://finances.wallonie.be/home/actualites.html',url:'https://finances.wallonie.be/home/actualites/actualites.rss',host:'finances.wallonie.be',kind:'spw'},
  fisconetplus:{title:'Fisconetplus — Actualités',site:'https://www.minfin.fgov.be/myminfin-web/pages/public/fisconet',url:'https://www.minfin.fgov.be/myminfin-rest/fisconetPlus/public/news',host:'www.minfin.fgov.be',kind:'fisconet'},
};
// Parseur XML strictement local: aucune entite externe ni ressource distante.
const parser = new XMLParser({ignoreAttributes:false, parseTagValue:false, trimValues:true});

export function text(value='') {
  // Retirer le balisage du resume officiel; ne jamais executer de script.
  return decodeHTML(String(value).replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi,'').replace(/<[^>]*>/g,' ')).replace(/\s+/g,' ').trim();
}
export function escapeXml(value='') {
  // Preserver Unicode valide et encoder tous les caracteres reserves du XML.
  return String(value).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\uFFFE\uFFFF]|\p{Surrogate}/gu,'')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
}
function canonical(value,source) {
  // Garder le lien original sur le domaine officiel, hors fragments de navigation.
  const url=new URL(value,source.site);
  if(url.protocol!=='https:'||url.hostname!==source.host||url.port||url.username||url.password)throw new Error('Lien hors du domaine officiel.');
  url.hash='';
  for(const key of [...url.searchParams.keys()])if(/^utm_/i.test(key))url.searchParams.delete(key);
  return url.href;
}
function date(value) {
  // Ne jamais remplacer une date absente par la date de collecte.
  if(!value)return null;
  if(/^\d{4}-\d{2}-\d{2}$/.test(value)){
    const parsed=new Date(`${value}T00:00:00Z`);
    if(!Number.isFinite(parsed.getTime())||parsed.toISOString().slice(0,10)!==value)throw new Error('Date officielle invalide.');
    return parsed.toISOString();
  }
  const parsed=new Date(value);
  if(!Number.isFinite(parsed.getTime()))throw new Error('Date officielle invalide.');
  return parsed.toISOString();
}
export function parseInasti(body) {
  // Exploiter les entites Drupal et leur UUID; aucune classe CSS n est utilisee.
  const data=JSON.parse(body);
  if(!Array.isArray(data.data)||data.errors?.length)throw new Error('Structure JSON:API INASTI inattendue.');
  const items=[];
  for(const node of data.data){
    const a=node.attributes;
    if(node.type!=='node--news'||!a||typeof a.langcode!=='string'||typeof a.status!=='boolean')throw new Error('Schema des actualites INASTI modifie.');
    if(!a.status||a.langcode!=='fr')continue;
    if(!node.id||typeof a.title!=='string'||!a.path?.alias)throw new Error('Article INASTI incomplet.');
    const path=a.path.alias.startsWith('/fr/')?a.path.alias:`/fr${a.path.alias}`;
    if(!path.startsWith('/fr/actualites/'))throw new Error('Alias INASTI inattendu.');
    items.push({id:`urn:inasti:fr:${node.id}`,title:text(a.title),link:canonical(path,sources.inasti),
      date:date(a.field_publication_date),summary:text(a.field_teaser?.processed||a.field_teaser?.value||''),
      content:cleanContent(a.field_article?.processed||a.field_article?.value||'',canonical(path,sources.inasti))});
  }
  const next=data.links?.next?.href||null;
  return {items,next};
}
export function parseRss(body,source) {
  // Refuser explicitement HTML, CAPTCHA, DTD et XML malforme avant publication.
  if(/<!DOCTYPE|<!ENTITY/i.test(body)||XMLValidator.validate(body)!==true)throw new Error('RSS: reponse non XML valide (HTML/CAPTCHA possible).');
  const channel=parser.parse(body).rss?.channel;
  if(!channel?.title||!channel.item)throw new Error('RSS: reponse sans canal RSS et articles (HTML/CAPTCHA possible).');
  const rows=Array.isArray(channel.item)?channel.item:[channel.item];
  return rows.map(row=>{
    // Garder identifiant officiel et URL pour eviter les doublons entre collectes.
    const title=text(row.title),link=canonical(row.link,source);
    if(!title||typeof row.link!=='string')throw new Error('RSS: article sans titre ou lien.');
    const guid=typeof row.guid==='object'?row.guid['#text']:row.guid;
    return {id:String(guid||link),title,link,date:date(row.pubDate),summary:text(row.description||''),content:cleanContent(row['content:encoded']||row.description||'',link)};
  });
}
export function parseSpf(body) {
  // Conserver le point d entree specialise utilise dans les tests existants.
  return parseRss(body,sources['spf-finances']);
}
export function mergeItems(previous,incoming,limit=200) {
  // Remplacer une edition du meme identifiant ou lien, puis conserver un historique borne.
  const result=[],ids=new Set(),links=new Set();
  for(const item of [...incoming,...previous]){
    if(ids.has(item.id)||links.has(item.link))continue;
    ids.add(item.id);links.add(item.link);result.push(item);
  }
  return result.sort((a,b)=>{
    // Utiliser la date officielle uniquement; conserver un ordre stable a date egale.
    return (b.date||'').localeCompare(a.date||'')||a.id.localeCompare(b.id);
  }).slice(0,limit);
}
export function renderRss(key,state,baseUrl,pathname=`/rss/${key}.xml`) {
  // Produire du RSS 2.0 UTF-8 avec lien de souscription et GUID stables.
  const source=sources[key],self=new URL(pathname,baseUrl).href;
  const xml=`<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:content="http://purl.org/rss/1.0/modules/content/">\n<channel>\n<title>${escapeXml(source.title)}</title>\n<link>${escapeXml(source.site)}</link>\n<description>Publié par Amnesian. Actualités publiques : consulter les articles sur les sites officiels.</description>\n<language>fr-be</language>\n<atom:link href="${escapeXml(self)}" rel="self" type="application/rss+xml"/>\n<lastBuildDate>${new Date(state.modifiedAt).toUTCString()}</lastBuildDate>\n<ttl>60</ttl>\n${state.items.map(item=>{
    // Publier le corps complet dans les deux champs pour les lecteurs RSS differents.
    const body=(item.content||`<p>${escapeXml(item.summary)}</p>`)+`<div data-feed-source="original"><hr /><p>Source officielle : <a href="${escapeXml(item.link)}">${escapeXml(item.link)}</a></p></div>`;
    // Les documents fiscaux longs utilisent CDATA et un resume separe pour eviter de doubler le flux.
    const encoded=key==='fisconetplus'?`<![CDATA[${body.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\uFFFE\uFFFF]|\p{Surrogate}/gu,'').replace(/\]\]>/g,']]]]><![CDATA[>')}]]>`:escapeXml(body);
    const description=key==='fisconetplus'?escapeXml(item.summary||item.title):escapeXml(body);
    return `<item>\n<title>${escapeXml(item.title)}</title>\n<link>${escapeXml(item.link)}</link>\n<guid isPermaLink="false">${escapeXml(item.id)}</guid>\n${item.date?`<pubDate>${new Date(item.date).toUTCString()}</pubDate>\n`:''}<description>${description}</description>\n<content:encoded>${encoded}</content:encoded>\n</item>`;
  }).join('\n')}\n</channel>\n</rss>\n`;
  return xml;
}
export function validateRss(xml) {
  // Controler syntaxe, champs RSS, dates et unicite des GUID et liens.
  if(XMLValidator.validate(xml)!==true)throw new Error('XML produit invalide.');
  const root=parser.parse(xml),channel=root.rss?.channel;
  if(root.rss?.['@_version']!=='2.0'||!channel?.title||!channel.link||!channel.description)throw new Error('Canal RSS 2.0 incomplet.');
  const rows=channel.item?(Array.isArray(channel.item)?channel.item:[channel.item]):[];
  const ids=new Set(),links=new Set();
  for(const row of rows){
    const id=row.guid?.['#text'];
    if(!row.title||!row.link||!id||ids.has(id)||links.has(row.link))throw new Error('Article invalide ou doublon RSS.');
    if(row.pubDate&&!Number.isFinite(Date.parse(row.pubDate)))throw new Error('pubDate invalide.');
    ids.add(id);links.add(row.link);
  }
  return {valid:true,items:rows.length,duplicateIds:0,duplicateLinks:0};
}
