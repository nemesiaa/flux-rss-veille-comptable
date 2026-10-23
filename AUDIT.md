# Verification des sources — 14 septembre 2026

## INASTI

Page examinee : https://www.inasti.be/fr/actualites

- HTTP serveur 200, HTML Drupal rendu des la premiere reponse.
- Les quatre balises `link rel="alternate"` sont des variantes de langue, pas des flux RSS/Atom.
- Pas de JSON-LD d articles dans la page examinee. Le JSON embarque `drupal-settings-json` contient la configuration Drupal, pas les actualites.
- Deux bundles JavaScript du site et jQuery inspectes. Le navigateur ne charge aucun XHR/fetch au premier affichage.
- Un clic sur « Page suivante » declenche `/fr/views/ajax`, vue `news`, affichage `all_news`, pagination `page=,1`. HTTP 200 application/json, mais les commandes `insert` contiennent du HTML. Ce n est pas une API de donnees editoriales; non retenue.
- `/rss.xml`, `/fr/rss.xml`, `/fr/actualites/rss.xml`, `/fr/actualites/rss` : HTTP 404. Aucun flux cache utilisable trouve; cela ne prouve pas une absence absolue sur tous les chemins possibles.
- `/graphql` : HTTP 404.
- `/fr/node/2?_format=json`, `/fr/actualites?_format=json`, variante hal_json : HTTP 406. La route rendue ne permet pas ces formats.
- **`/jsonapi` et `/fr/jsonapi` : HTTP 200, application/vnd.api+json.** L index annonce explicitement la ressource `node--news`.
- **Source retenue : https://www.inasti.be/fr/jsonapi/node/news**.

Requete de production : filtre `status=1`, tri `-field_publication_date,-created`, page de 50, champs limites a titre/langue/statut/alias/date/teaser/creation/modification/identifiant Drupal. Suivi des liens `next`, au maximum quatre pages par collecte. La langue est verifiee dans chaque entite; seule `fr` est retenue.

Premiere page : 43 entites accessibles en francais. Toutes les URLs des 12 cartes de la page publique d actualites sont presentes dans la reponse API. Les dates sont issues de `field_publication_date`, et non de `created` : la premiere actualite affiche le 1 septembre 2026 alors que le noeud Drupal a ete cree en mai 2024.

UUID officiel utilise comme GUID RSS. L alias donne le lien `/fr/actualites/...`. `field_teaser.processed` fournit le resume. Aucune collecte HTML ni ouverture des articles n est necessaire. Depuis la demande de contenu integral, `field_article.processed` est egalement demande et son HTML est nettoye en conservant le texte et les liens.

## SPF Finances

Source : https://finances.belgium.be/fr/Actualites/rss.xml

| Essai depuis ce serveur | HTTP | Content-Type | RSS lu | Redirection |
|---|---:|---|---:|---|
| Requete standard Node fetch | 200 | application/rss+xml; charset=utf-8 | 10 articles | non |
| User-Agent Chrome ordinaire | 200 | application/rss+xml; charset=utf-8 | 10 articles | non |
| Accept RSS/XML explicite | 200 | application/rss+xml; charset=utf-8 | 10 articles | non |
| Cookie recu lors d une visite de la page d accueil | 200 | application/rss+xml; charset=utf-8 | 10 articles | non |

Le serveur emet un cookie mais celui-ci n est pas necessaire pour lire le flux pendant cet audit. Sa valeur n est ni publiee ni conservee. Aucun CAPTCHA rencontre sur ces quatre essais; le comportement peut differer selon l adresse IP de sortie (notamment celle de Cloudflare).

Le collecteur verifie le statut HTTP, le Content-Type, la syntaxe XML et la presence d un vrai canal RSS. Une page HTML, meme servie en HTTP 200, est rejetee. Les DTD et declarations d entites sont refusees. Les redirections sont bornees et restent sur le domaine officiel.

Repli : un essai de navigateur ordinaire, puis dernier cache valide et reprise espacee (1, 2, 4, puis 6 heures). Aucun service de resolution de CAPTCHA, proxy payant ou contournement. En cas de blocage durable de toutes les requetes, le cache reste lisible mais aucune nouvelle actualite ne peut etre inventee. Le meme code peut etre auto-heberge sur le serveur local ou une autre machine autorisee.

## Hebergement

Vercel Hobby est reserve a l usage personnel non commercial et ses cron jobs sont limites a une execution par jour. Pour le projet personnel, Cloudflare Workers + Workers KV est prepare sur l offre gratuite, dans les quotas. Un compte Cloudflare et son autorisation restent indispensables pour obtenir une URL publique effective.

References :
- https://www.inasti.be/fr/jsonapi
- https://www.inasti.be/fr/jsonapi/node/news
- https://www.drupal.org/docs/core-modules-and-themes/core-modules/jsonapi-module/fetching-resources-get
- https://www.drupal.org/docs/core-modules-and-themes/core-modules/jsonapi-module/sorting
- https://www.inoreader.com/feed-fetcher
- https://vercel.com/docs/limits/fair-use-guidelines
- https://developers.cloudflare.com/workers/platform/limits/
- https://developers.cloudflare.com/kv/platform/limits/

## Extension personnelle — Belgium.be

Source officielle testee le 14 septembre 2026 : https://news.belgium.be/fr/feeds/all. HTTP 200, application/rss+xml; charset=utf-8, 10 communiques et XML valide depuis le serveur local. Les elements n ont pas tous de GUID : leur URL officielle fournit alors un identifiant stable. Le flux fournit seulement les introductions; les pages articles sont maintenant analysees pour recuperer le corps editorial.

Le projet est personnel et publie sous le pseudonyme Amnesian. Cloudflare reste utilise pour la collecte horaire; la restriction professionnelle Vercel citee dans l audit initial ne s applique pas a cet usage personnel.

## Belgium.be — relais personnel

Source officielle : https://news.belgium.be/fr/feeds/all. GET Node local : HTTP 200 et RSS valide, 10 articles. Depuis Cloudflare : HTTP 403 HTML Access Denied avec requete standard, User-Agent navigateur et Accept XML. Les chemins /jsonapi et /fr/jsonapi renvoient 404. Un relais Node personnel recupere le RSS officiel, le valide et le depose via une route authentifiee du Worker. Extraction HTML des corps editoriaux uniquement; aucun solveur de CAPTCHA. Les nouvelles publications de cette source dependent du serveur du relais allume.

## Verification du contenu integral — 14 septembre 2026

INASTI : `field_article.processed` disponible dans JSON:API pour les 43 articles. Belgium.be : les dix pages ont une introduction et un conteneur de paragraphes comprenant toutes les sections; un test reel verifie notamment les quatre sections du communique sur la Porte de Louvain. SPF : comparaison des dix descriptions RSS avec le champ `field-name-body` des dix pages officielles; tout le texte correspond apres normalisation des espaces et traitement identique des liens.

Conditions de reutilisation consultees :
- https://www.inasti.be/fr/conditions-de-reutilisation-licence-creative-commons-0
- https://news.belgium.be/fr/conditions-de-reutilisation
- https://finances.belgium.be/fr/disclaimer

Les trois sites autorisent la reutilisation du texte (CC0, sauf mention contraire); les medias ont des conditions distinctes. Les images sont donc liees vers les originaux au lieu d etre incorporees. La date et le lien source sont conserves.

## SPW et Fisconetplus — 14 septembre 2026

SPW : HTML source Jahia inspecte, balises alternate limitees aux langues. JSON embarque limite a la configuration Jahia et aux scripts. Javascript examine : mise en page/navigation, cartes deja rendues dans le HTML. Chemins /rss.xml, /home/actualites.rss.xml, /home/actualites/actualites.rss.xml indisponibles. Le test /home/actualites/actualites.rss renvoie cependant un RSS officiel et a ete retenu. API JCR live/fr paths/sites/finances et nodes/site-UUID : 404 PathNotFound. GraphQL : GqlAccessDeniedException sur requete publique. Un RSS exploitable pour les titres et liens a finalement ete trouve : /home/actualites/actualites.rss. Il ne contient que des resumes et ses dates demandent correction depuis les pages. Premier echantillon et ancienne URL 2025 ont le meme conteneur de corps. Reutilisation non commerciale avec source autorisee : https://finances.wallonie.be/home/mentions-legales.html.

Fisconetplus : navigation dans https://www.minfin.fgov.be/myminfin-web/pages/public/fisconet et observation XHR. Endpoint /myminfin-rest/fisconetPlus/public/news trouve. Le guide ancien mentionne du RSS mais aucun flux RSS n est annonce dans la page actuelle. API publique prioritaire : Accept-Language fr + fragmentid fisconetplus donnent cinq annonces completes sans cookies. Requete standard sans ce contexte : tableau data vide, donc ce cas est traite comme erreur et non comme un flux vide valide. La collection news est distincte de changes/count et de navigation/tree; seules les actualites de la page d accueil sont couvertes ici.

Les listes ne manquent pas dans le XML INASTI actuel : neuf puces presentes pour l article signale. Leur absence dans le compte Inoreader n a pas pu etre reproduite sans acces a ce compte. Une URL de souscription distincte et une lecture publique directe sont fournies pour distinguer contenu de la source et contenu memorise par le lecteur.

## RSS SPW retenu apres verification complete des sondes

Le chemin https://finances.wallonie.be/home/actualites/actualites.rss repond HTTP 200 application/rss+xml et fournit 28 references. Il est prefere au parsing de l index HTML. Les douze premieres entrees sont collectees, puis les corps et dates sont lus sur les pages officielles. Des dates RSS sont en francais et ne respectent pas RFC 822; la reduction pour familles monoparentales porte meme une date RSS de mars alors que la page affiche une publication du 23 juin 2026. Cette derniere est conservee. Le RSS contient aussi une annonce du 7 juillet au gabarit newsText, absente de la premiere page de cartes; ce second gabarit est couvert et teste. Treize articles sont conserves apres fusion avec l historique de la premiere collecte.


## Fisconetplus : ouverture des documents, 14 septembre 2026

Audit navigateur de « Modifications recentes » puis ouverture de la circulaire 2026/C/86. L API `changes/searches?language=fr&month=9&year=2026` renvoie 259 lignes, soit 229 GUID distincts dans 16 matieres; la pagination de dix lignes est appliquee par le navigateur, pas par cet endpoint. `changes/count` seul ne fournit pas les documents. `navigation/tree` sert au classement.

L API `public/document/<guid>` contient des metadonnees et le corps HTML/PDF encode en base64. Son HTML inclut les sections situees apres la table des matieres. Aucune extraction des gros titres de la page Angular n est utilisee. Les versions multiples d un meme GUID sont dedoublonnees. La collecte ouvre egalement les documents directement lies par les annonces; une annonce de dossier sans document direct conserve son lien de navigation.

Initialisation: 217 documents HTML et 11 PDF parmi les 229 references mensuelles. La reference `748f398b-526d-4f85-97b8-7be6eb831be9` renvoie HTTP 400 / INTERNAL_ERROR depuis l API officielle, confirme par une seconde requete. Les documents des annonces ajoutent trois corps HTML; une annonce reste un lien de dossier. Total : 232 entrees, dont 220 corps HTML, 11 notices PDF explicites et une annonce de dossier.

Les documents HTML sont repris en entier; les PDF et annexes restent consultables par leurs liens. La base historique et les documents lies de proche en proche ne sont pas recopies recursivement. Le XML complet pese environ 9,6 Mo: le corps figure une seule fois en CDATA dans content:encoded, avec un resume dans description. Le XML prepare est servi depuis KV pour eviter un rendu a chaque lecture. Les limites gratuites et le volume futur restent a surveiller : https://developers.cloudflare.com/workers/platform/limits/ et https://developers.cloudflare.com/kv/platform/limits/.
