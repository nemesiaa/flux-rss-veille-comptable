/* Programme: Actualites publiques - Contenu integral des articles
   Date: 2026-09-14 - Auteur: nemesiaa
   Module utilise par npm start et le Worker; aucun fichier produit directement.
   Conserve textes, titres, listes, tableaux et liens sans scripts ni styles.
   Voir README.md pour la collecte et la verification des flux enrichis. */
import {parseDocument} from 'htmlparser2';
import {findAll,getInnerHTML,textContent} from 'domutils';

// Elements editoriaux compatibles avec les lecteurs RSS.
const allowed=new Set('div p br hr h1 h2 h3 h4 h5 h6 ul ol li strong b em i u s blockquote pre code table thead tbody tfoot tr th td caption dl dt dd sup sub a'.split(' '));
// Ne jamais conserver le texte de composants executables ou de navigation.
const dropped=new Set('script style iframe object embed form input button nav noscript svg template'.split(' '));

function escape(value='') {
  // Encoder le texte une seule fois apres son decodage par le parseur HTML.
  return String(value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function safeLink(value,base) {
  // Resoudre les liens relatifs sans autoriser javascript, data ou des identifiants URL.
  try{const url=new URL(value,base);return ['https:','http:','mailto:','tel:'].includes(url.protocol)&&!url.username&&!url.password?url.href:null;}
  catch{return null;}
}
export function cleanContent(html,base) {
  // Garder le contenu editorial et transformer les medias en liens vers l original.
  const document=parseDocument(String(html||''));
  function serialize(node) {
    // Reconstruire un HTML limite a une liste positive de balises et attributs.
    if(node.type==='text')return escape(node.data);
    if(node.type==='comment'||dropped.has(node.name)||node.attribs?.['data-feed-source']==='original')return '';
    const children=(node.children||[]).map(serialize).join('');
    if(node.name==='img'){
      const url=safeLink(node.attribs?.src,base);
      return url?`<p><a href="${escape(url)}">${escape(node.attribs?.alt||'Illustration sur le site officiel')}</a></p>`:'';
    }
    if(!allowed.has(node.name)){
      // Traduire seulement les emphases editoriales connues, sans conserver de CSS arbitraire.
      const style=node.attribs?.style||'';
      let result=children;
      if(/font-weight\s*:\s*(?:bold|[7-9]00)\b/i.test(style))result=`<strong>${result}</strong>`;
      if(/font-style\s*:\s*italic\b/i.test(style))result=`<em>${result}</em>`;
      return result;
    }
    let attributes='';
    if(node.name==='a'){
      const url=safeLink(node.attribs?.href,base);
      if(!url)return children;
      attributes=` href="${escape(url)}"`;
    }
    for(const key of ['colspan','rowspan'])if(['td','th'].includes(node.name)&&/^\d{1,2}$/.test(node.attribs?.[key]||''))attributes+=` ${key}="${node.attribs[key]}"`;
    if(['br','hr'].includes(node.name))return `<${node.name} />`;
    return `<${node.name}${attributes}>${children}</${node.name}>`;
  }
  return serialize(document).trim();
}
function hasClass(node,name) {
  // Utiliser les noms de champs Drupal stables, pas les classes de mise en page.
  return (node.attribs?.class||'').split(/\s+/).includes(name);
}
export function extractBelgium(html,link) {
  // Les communiques contiennent une introduction suivie de plusieurs paragraphes Drupal.
  const document=parseDocument(html);
  const intros=findAll(node=>hasClass(node,'field--name-field-news-intro'),document.children);
  const sections=findAll(node=>hasClass(node,'field--paragraphs'),document.children);
  if(intros.length!==1||sections.length!==1||!textContent(sections[0]).trim())throw new Error('Belgium.be: structure du corps editorial modifiee ou article vide.');
  const blocks=[getInnerHTML(intros[0]),getInnerHTML(sections[0])];
  const pdf=findAll(node=>node.name==='a'&&/^\/fr\/node\/\d+\/pdf$/.test(node.attribs?.href||''),document.children)[0];
  if(pdf)blocks.push(`<p><a href="${escape(pdf.attribs.href)}">Version PDF officielle</a></p>`);
  const content=cleanContent(blocks.join('\n'),link);
  if(!content)throw new Error('Belgium.be: aucun texte editorial apres extraction.');
  return content;
}
