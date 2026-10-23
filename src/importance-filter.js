/* Programme: Actualites publiques - Filtre de lecture Inoreader
   Date: 2026-09-28
   Auteur: nemesiaa
   Execution: importe par npm start, npm run refresh et npm test.
   Produit: aucun fichier; retourne seulement les articles a publier dans les flux RSS. */

// Termes qui indiquent du bruit administratif ou local.
const blockedTerms=['adjudication','adjudications','marche public','marches publics','avis de marche','attribution de marche','resultat d adjudication','resultats d adjudications','commune de','ville de','conseil communal','cpas','permis d urbanisme','enquete publique','travaux publics','jugement du tribunal','arret de la cour','cour d appel','cour de justice europeenne'];
// Termes pratiques a forte valeur pour une veille fiscale courte.
const impactTerms=['delai','delais','report','reporte','prolongation','echeance','declaration','formulaire','indisponibilite','obligation','obligatoire','entree en vigueur','reforme','modification','changement','tolerance','circulaire','actualites fiscales','actualites economiques','myminfin','biztax','intervat','peppol','facturation electronique'];
// Domaines utiles pour eviter les actualites juridiques generales.
const fiscalTerms=['fiscal','fiscale','fiscalite','impot','impots','ipp','isoc','tva','precompte','cotisation','cotisations','douane','douanes','import','importation','export','accise','accises','taxe','taxes','droits d enregistrement','droits de succession','entreprise','entreprises','employeur','societe','pme','independant','independants','vehicule','automobile'];
// Types Fisconetplus qui produisent beaucoup de bruit pour Inoreader.
const blockedFisconetTypes=['jurisprudence belge','jurisprudence europeenne','questions parlementaires','table des matieres','commentaires'];
// Bruit recurrent des communiques federaux pour un lecteur comptable.
const blockedBelgiumTerms=['adjudication','certificats de tresorerie','olo','montant a adjuger'];
// Signaux minimum pour garder Belgium.be dans une veille comptable.
const belgiumKeepTerms=['inasti','retenue sur factures','fiscal','fiscale','fiscalite','impot','impots','taxe annuelle','taxes fiscales','tva','cotisation','cotisations','independant','independants','entreprise','entreprises','societe','societes','pme','employeur','employeurs','spf finances','precompte','declaration fiscale','delai fiscal','obligation fiscale','obligation de retenue','cour de cassation','organismes de placement collectif'];

export function normalizeForImportance(value='') {
  // Comparer sans accents, balises ni apostrophes typographiques.
  return String(value).replace(/<[^>]*>/g,' ').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[’']/g,' ').replace(/\s+/g,' ').trim().toLocaleLowerCase('fr');
}

function hasTerm(text,terms) {
  // Lire les listes de mots comme des regles simples et auditables.
  return terms.some(term=>text.includes(normalizeForImportance(term)));
}

function fisconetText(row) {
  // Regrouper les champs disponibles sans imposer un schema unique.
  return normalizeForImportance([row.title,row.summary,row.taxonomy,row.taxonomyTerm,row.documentType].filter(Boolean).join(' '));
}

export function isImportantFisconetRow(row) {
  // Garder les references Fisconetplus utiles et bloquer le bruit massif.
  const text=fisconetText(row),type=normalizeForImportance(row.documentType||''),title=normalizeForImportance(row.title||'');
  if(!text||hasTerm(text,blockedTerms))return false;
  const datedTitle=title.match(/^(\d{2})\.(\d{2})\.(\d{4})/);
  if(datedTitle&&Number(datedTitle[3])<2024)return false;
  if(title.includes('decision anticipee'))return false;
  if(title.includes('abrogee'))return false;
  if((title.includes('newsletter')||title.includes('nieuwsbrief')||title.includes('ontdek de'))&&!hasTerm(title,['actualites fiscales','actualites economiques']))return false;
  if(blockedFisconetTypes.some(item=>type.includes(item)))return false;
  if(type.includes('brochures et publications')&&!hasTerm(text,['actualites fiscales','actualites economiques','fiscalite automobile']))return false;
  if(type.includes('code et legislation')&&!hasTerm(text,['entree en vigueur','reforme','modification','declaration','delai','obligation']))return false;
  if(type.includes('arretes royaux')&&!hasTerm(text,['entree en vigueur','reforme','modification','declaration','delai','obligation']))return false;
  return hasTerm(text,fiscalTerms)&&hasTerm(text,impactTerms);
}

export function isImportantFeedItem(key,item) {
  // Appliquer un filtre uniquement aux flux trop bruyants.
  if(key==='belgium'){
    const text=normalizeForImportance(item.title||'');
    return !hasTerm(text,blockedBelgiumTerms)&&hasTerm(text,belgiumKeepTerms);
  }
  if(key!=='fisconetplus')return true;
  return isImportantFisconetRow(item);
}
