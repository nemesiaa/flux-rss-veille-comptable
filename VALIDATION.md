# Validation — 14 septembre 2026

- Deployment public : https://actualites.flux-publics.workers.dev ; trois URLs sans reference au cabinet, publication attribuee a Amnesian.
- `npm test` : 19 tests passes, dont JSON:API, XML/RSS, doublons, reprise apres erreur, persistance, routes HTTP, cron et relais authentifie Belgium.be.
- `npm run verify -- https://actualites.flux-publics.workers.dev` : trois flux HTTP 200, XML/RSS 2.0 UTF-8 valides, HEAD 200, ETag/304 et alias 200. Zero doublon de GUID ou de lien.
- INASTI : 43 articles ; SPF Finances : 10 ; Belgium.be : 10. Les trois caches sont frais lors du controle.
- Collecte reelle INASTI et SPF depuis Cloudflare reussie. Cron `17 * * * *` deploye ; le prochain declenchement horaire n a pas ete attendu.
- Belgium.be : les requetes Cloudflare renvoient HTTP 403 HTML. Collecte locale reelle reussie le 14 septembre a 14:40:50 UTC ; publication authentifiee dans le cache public reussie a 14:40:52 UTC. Relais actif dans tmux, dependant du serveur allume, sans demarrage automatique au reboot.
- Verification XML independante ElementTree sur les trois URLs publiques, avec dates et unicite des identifiants/liens.
- Compatibilite Inoreader verifiee au niveau HTTP et RSS avec son User-Agent ; aucun abonnement effectue dans le compte Inoreader.
- Docker/Caddy fournis mais non executes ici (Docker absent).
- Ancien Worker supprime ; OAuth et secrets exclus de l archive. Le fichier .env local est prive (permissions 600).

## Contenu integral

- 43 corps INASTI obtenus directement par l API, 10 corps Belgium.be extraits et 10 corps SPF conserves du RSS.
- Les dix textes SPF correspondent a ceux des pages officielles apres normalisation des espaces.
- Tests supplementaires : HTML non executable, liens relatifs, toutes les sections Belgium, round-trip du relais sans reduction de contenu ni multiplication du pied source, correction des corps lors d un RSS 304, conservation du corps complet en cas d erreur.
- Ancienne URL : echec DNS constate depuis le serveur; ancienne route sur le nouveau sous-domaine : HTTP 404. Suppression du Worker historique confirmee par API Cloudflare. Un cache navigateur ou Inoreader distant reste hors controle du service.

- Verification apres deploiement : 63 articles publics avec corps integral identique au cache collecte (43 INASTI, 10 SPF, 10 Belgium), un seul pied source, aucune ancienne marque. XML controles independamment avec ElementTree, HEAD/304/alias valides.
- Collecte INASTI et SPF executee avec succes depuis Cloudflare a 14:50:57 UTC; corps Belgium publies par le relais a 14:50:58 UTC.

## Extension SPW/Fisconetplus et listes

- 25 tests passes. Cas exact INASTI : neuf puces conservees dans description et content:encoded; rendu visible avec list-style disc dans le navigateur.
- Collecte reelle Cloudflare reussie le 14 septembre 2026 a 15:09:20 UTC : SPW 12 articles, Fisconetplus 5 annonces, aucune erreur. INASTI et SPF egalement rafraichis avec succes.
- Cinq flux publics : 81 articles, 262 elements li preserves (INASTI 206, Belgium 23, SPF 14, SPW 19, Fisconetplus 0).
- Cinq nouvelles URL -complet.xml : HTTP 200, atom:self exact, XML/RSS valide, contenu HTML identique entre description et content:encoded, un seul lien source final, zero doublon de GUID ou de lien.
- Les 262 puces publiques ont ete comparees une par une au cache collecte. Resultats dans examples/verification.json.
- Affichage du compte Inoreader non verifie; aucun changement d abonnement effectue a la place de l utilisateur.

- RSS officiel SPW finalement retenu comme index; verification des liens canoniques et de deux gabarits de pages. Dates affichees prioritaires sur les dates RSS mal formees/incoherentes. 13 articles apres fusion avec le cache precedent, aucun doublon.

- Version finale deployee : 0ea85770-b33f-42f3-b184-bd8426591f35. Collecte cloud via RSS SPW reussie a 15:16:49 UTC; 13 articles publics. Verification finale des cinq URL completes : HTTP 200, HEAD 200, ETag 304 et XML valide.

## Correction documentaire Fisconetplus — 14 septembre 2026

- 28 tests passent : corps reel d une circulaire jusque sa derniere reference, tableau, annexes, versions multiples, 16 matieres, traitement par lots, reprise apres erreur, cache sans relire un document inchange, PDF signale, XML CDATA et caracteres interdits, ETag faible apres compression.
- API de septembre : 259 lignes, 229 documents distincts. Cache final : 232 entrees comprenant 220 documents HTML, 11 PDF avec lien de consultation et une annonce de dossier. Une reference officielle renvoie HTTP 400 et reste en attente.
- Collecte depuis Cloudflare testee a 15:32:51 UTC : 232 entrees conservees, liste et annonces relues, reference en erreur journalisee individuellement. Autres sources verifiees sans regression.
- XML public : 9 637 343 octets pour l adresse -complet, valide avec ElementTree et le validateur JS. Zero doublon de GUID ou lien. Les 232 corps correspondent au cache collecte apres normalisation XML des fins de ligne. Details dans examples/verification.json.
- Les cinq flux passent les controles HTTP 200, HEAD 200, ETag/304 et alias. Le flux Fisconetplus prepare est servi en streaming. Les journaux Worker observes ne contiennent aucune exception; pas de mesure CPU disponible dans cette sortie de logs.
- Page de lecture ouverte dans le navigateur : 232 articles; circulaire 2026/C/86 avec sa reference finale 742.989/8, son tableau et les annexes. Le compte Inoreader reste inaccessible : son affichage effectif n est pas certifie par ces controles.
- Inventaire Cloudflare : seul Worker actualites; cinq caches de sources et trois representations Fisconetplus preparees. Aucun ancien Worker lpf-rss ou cache abandonne. Les alias actuels sont conserves pour les abonnements existants, sauf demande explicite de retrait.

- Version finale deployee : `2d1dc6cb-bb70-4cfc-a57d-b7af153b8c1b`. Anciennes URL : ENOTFOUND sur l ancien sous-domaine, HTTP 404 sur l ancien nom de Worker dans le nouveau sous-domaine.
