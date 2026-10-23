/* Programme: Actualites publiques - SPW Finances et Fisconetplus
   Date: 2026-09-14 - Auteur: nemesiaa
   Execute par npm start, npm run refresh ou le cron Cloudflare.
   Produit les donnees normalisees pour data/spw-finances.json et data/fisconetplus.json.
   Voir README.md pour les URL, le deploiement et les limites de couverture. */
import {parseDocument} from 'htmlparser2';
import {findAll,getInnerHTML,textContent,removeElement} from 'domutils';
import {cleanContent} from './content.js';
import {XMLParser,XMLValidator} from 'fast-xml-parser';

export function parseSpwRss(xml) {
  // Le flux Jahia existe mais ses dates localisees sont incorrectes; lire les dates sur les articles.
  if(/<!DOCTYPE|<!ENTITY/i.test(xml)||XMLValidator.validate(xml)!==true)throw new Error('SPW: RSS non XML valide.');
  const channel=new XMLParser({parseTagValue:false}).parse(xml).rss?.channel;
  if(!channel?.item)throw new Error('SPW: RSS sans articles.');
  const rows=Array.isArray(channel.item)?channel.item:[channel.item];
  return rows.slice(0,12).map(row=>{
    // Les URL rendues par Jahia redirigent vers les alias canoniques publics.
    const url=new URL(row.link);
    if(url.protocol!=='https:'||url.hostname!=='finances.wallonie.be'||url.username||url.password||url.port||!row.title)throw new Error('SPW: lien ou titre RSS invalide.');
    return {id:url.href,link:url.href,sourceLink:url.href,title:normalized(parseDocument(row.title)),summary:normalized(parseDocument(row.description||''))};
  });
}

function normalized(node) {
  // Conserver les caracteres accentues tout en supprimant les espaces de mise en page.
  return textContent(node).replace(/\s+/g,' ').trim();
}
function officialDate(value) {
  // Ne pas inventer une date lorsque la source change son schema.
  if(!/^\d{4}-\d{2}-\d{2}$/.test(value||''))throw new Error('Date officielle absente ou invalide.');
  const date=new Date(value+'T00:00:00Z');
  if(!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==value)throw new Error('Date officielle impossible.');
  return date.toISOString();
}
export function parseSpwIndex(html) {
  // Les balises article, h2 et time sont semantiques et stables sur le portail Jahia.
  const document=parseDocument(html),items=[];
  for(const article of findAll(node=>node.name==='article',document.children)){
    const anchor=findAll(node=>node.name==='a'&&/^\/(?:actualite\/|home\/actualites\/actualites\/)/.test(node.attribs?.href||''),article.children)[0];
    if(!anchor)continue;
    const heading=findAll(node=>node.name==='h2',article.children)[0];
    const time=findAll(node=>node.name==='time',article.children)[0];
    const intro=findAll(node=>node.name==='p',article.children)[0];
    if(!heading||!time||!normalized(heading))throw new Error('SPW: carte actualite incomplete.');
    const link=new URL(anchor.attribs.href,'https://finances.wallonie.be').href;
    items.push({id:link,link,title:normalized(heading),date:officialDate(time.attribs.datetime),summary:intro?normalized(intro):''});
  }
  if(!items.length)throw new Error('SPW: liste des actualites introuvable.');
  return items.slice(0,24);
}
export function extractSpw(html,link) {
  // Extraire tout le corps de l article, y compris listes, tableaux et annexes liees.
  return readSpwArticle(html,link).content;
}
export function readSpwArticle(html,link) {
  // Le portail utilise deux gabarits publics; recuperer date affichee et URL canonique dans les deux.
  const document=parseDocument(html);
  const articles=findAll(node=>node.name==='article'&&(node.attribs?.class||'').split(/\s+/).includes('node--type-article'),document.children);
  const canonical=findAll(node=>node.name==='link'&&node.attribs?.rel==='canonical',document.children)[0];
  const url=new URL(canonical?.attribs?.href||link);
  if(url.protocol!=='https:'||url.hostname!=='finances.wallonie.be'||url.username||url.password||url.port)throw new Error('SPW: URL canonique interdite.');
  let section,date;
  if(articles.length===1){
    section=articles[0];const time=findAll(node=>node.name==='time',section.children)[0];date=officialDate(time?.attribs?.datetime);
    for(const node of findAll(node=>node.name==='time'||(node.name==='ul'&&(node.attribs?.class||'').split(/\s+/).includes('cats')),section.children))removeElement(node);
  }else{
    const bodies=findAll(node=>(node.attribs?.class||'').split(/\s+/).includes('newsText'),document.children);
    const time=findAll(node=>(node.attribs?.class||'').split(/\s+/).includes('newsDate'),document.children)[0];
    const match=time&&normalized(time).match(/^(\d{2})\/(\d{2})\/(\d{4})/);
    if(bodies.length!==1||!match)throw new Error('SPW: structure du corps editorial modifiee.');
    section=bodies[0];date=officialDate(`${match[3]}-${match[2]}-${match[1]}`);
  }
  const content=cleanContent(getInnerHTML(section),url.href);
  if(!normalized(parseDocument(content)))throw new Error('SPW: article vide.');
  return {content,date,link:url.href,id:url.href};
}
export function parseFisconet(body) {
  // API publique observee dans MyMinfin; elle fournit deja le corps HTML des actualites.
  const response=JSON.parse(body);
  if(response.error||response.sessionExpired||response.mustRedirectToHome||!Array.isArray(response.data)||!response.data.length)throw new Error('Fisconetplus: API vide, indisponible ou schema modifie.');
  const site='https://www.minfin.fgov.be/myminfin-web/pages/public/fisconet';
  return response.data.map(row=>{
    // L API n expose pas d UUID pour les annonces; utiliser date et destination documentaire.
    if(typeof row.title!=='string'||typeof row.body!=='string'||!row.title.trim())throw new Error('Fisconetplus: annonce incomplete.');
    const date=officialDate(row.date),content=cleanContent(row.body,site),document=parseDocument(content);
    const links=findAll(node=>node.name==='a'&&node.attribs?.href,document.children);
    let link;
    for(const node of links){
      const candidate=new URL(node.attribs.href);
      if(['www.minfin.fgov.be','eservices.minfin.fgov.be'].includes(candidate.hostname)&&candidate.pathname.startsWith('/myminfin-web/pages/public/fisconet/')){candidate.hostname='www.minfin.fgov.be';link=candidate.href;break;}
    }
    if(!link||!normalized(document))throw new Error('Fisconetplus: corps ou lien documentaire officiel absent.');
    return {id:`urn:fisconetplus:${row.date}:${link}`,title:row.title.trim(),date,link,summary:normalized(document),content};
  });
}
