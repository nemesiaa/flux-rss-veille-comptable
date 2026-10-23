# Flux RSS pour la veille comptable

Flux RSS pour suivre les actualités de l'INASTI, du SPF Finances, de Belgium.be, du SPW Finances et de Fisconetplus dans Inoreader. Le service conserve les articles déjà collectés, évite les doublons et fournit le contenu des publications dans un format lisible.

Le même code fonctionne sur un serveur Node.js ou sur Cloudflare Workers. Les données sont récupérées directement auprès des organismes officiels ; aucune plateforme RSS tierce n'est nécessaire.

Projet indépendant, sans affiliation avec les organismes cités. Chaque article renvoie vers sa publication officielle.

## Sources suivies

| Organisme | Source utilisée | Flux produit |
| --- | --- | --- |
| INASTI | [API des actualités](https://www.inasti.be/fr/jsonapi/node/news) | [`/rss/inasti.xml`](https://actualites.flux-publics.workers.dev/rss/inasti.xml) |
| SPF Finances | [RSS officiel des actualités](https://finances.belgium.be/fr/Actualites/rss.xml) | [`/rss/spf-finances.xml`](https://actualites.flux-publics.workers.dev/rss/spf-finances.xml) |
| Belgium.be | [RSS des communiqués](https://news.belgium.be/fr/feeds/all) | [`/rss/belgium.xml`](https://actualites.flux-publics.workers.dev/rss/belgium.xml) |
| SPW Finances | [RSS des actualités](https://finances.wallonie.be/home/actualites/actualites.rss) | [`/rss/spw-finances.xml`](https://actualites.flux-publics.workers.dev/rss/spw-finances.xml) |
| Fisconetplus | [API des actualités MyMinfin](https://www.minfin.fgov.be/myminfin-rest/fisconetPlus/public/news) | [`/rss/fisconetplus.xml`](https://actualites.flux-publics.workers.dev/rss/fisconetplus.xml) |

L'INASTI ne proposait pas de flux RSS exploitable : sa source structurée JSON:API alimente le flux créé ici. Le SPF Finances propose déjà un RSS ; ce projet le valide et le republie pour les lecteurs qui rencontrent des blocages d'accès. Les autres sources utilisent leurs flux ou API officiels, avec lecture des articles lorsque le flux ne contient qu'un résumé.

Chaque source possède aussi un alias `/<source>.xml`. Les chemins `/rss/<source>-complet.xml` donnent accès à une version destinée à l'importation du contenu intégral. Les liens et identifiants des articles restent ceux des sources officielles.

L'[état de l'instance publiée](https://actualites.flux-publics.workers.dev/health) indique la fraîcheur du cache de chaque source.

## Prérequis

- Node.js 22 ou plus récent et npm ;
- accès HTTPS sortant vers les sites officiels ;
- pour Cloudflare : un compte Workers et un espace Workers KV.

## Démarrage local

```bash
npm ci
npm test
npm run refresh
npm start
```

Le serveur écoute sur `http://127.0.0.1:3190`. Vérifiez les flux avec :

```bash
npm run verify -- http://127.0.0.1:3190
```

`npm run refresh` crée `data/<source>.json`, `data/cloudflare-seed.json` et des exemples XML dans `examples/`. Le serveur conserve les articles dans `data/` et relance la collecte à échéance. Ces fichiers générés restent hors Git. Ne lancez pas `npm run refresh` pendant qu'une autre instance utilise le même dossier de données.

Pour adapter le port, le dossier de cache ou l'URL publique, copiez `.env.example` vers `.env` puis modifiez les valeurs. `.env` est exclu du dépôt.

## Déploiement sur Cloudflare Workers

1. Connectez-vous avec `npm run cloud:login`.
2. Créez le stockage : `npx wrangler kv namespace create RSS_CACHE`.
3. Remplacez `REMPLACER_PAR_IDENTIFIANT_KV` dans `wrangler.jsonc` par l'identifiant renvoyé. Vous pouvez également choisir un autre nom de Worker. Si plusieurs comptes Cloudflare sont accessibles, définissez `account_id` localement dans ce fichier.
4. Initialisez le cache et publiez :

```bash
npm run refresh
npx wrangler kv bulk put data/cloudflare-seed.json --binding RSS_CACHE --remote
npm run cloud:check
npm run cloud:deploy
```

La dernière commande affiche l'adresse HTTPS publique. Vérifiez-la avec :

```bash
npm run verify -- https://VOTRE-WORKER.VOTRE-SOUS-DOMAINE.workers.dev
```

Le Worker sert les articles depuis son cache ; les visites des lecteurs ne sollicitent pas les sites officiels. La tâche planifiée collecte les nouvelles publications. Les flux doivent rester accessibles sans connexion pour les lecteurs RSS.

Pour lancer une collecte manuelle, définissez un secret Worker avec `npx wrangler secret put REFRESH_TOKEN`, placez la même valeur dans `RSS_REFRESH_TOKEN` dans votre `.env`, puis exécutez :

```bash
npm run cloud:refresh -- https://VOTRE-WORKER.VOTRE-SOUS-DOMAINE.workers.dev
```

**Cas particulier de Belgium.be.** Lors des essais, la source officielle refusait les requêtes issues de Cloudflare. Un relais Node peut alors effectuer la collecte depuis un autre serveur : définissez `RSS_PUBLIC_ORIGIN`, `RSS_REFRESH_TOKEN` et `RSS_RELAY_ONLY=belgium` dans `.env`, puis lancez `npm start`. Le secret doit correspondre à `REFRESH_TOKEN` dans le Worker. Si le relais s'arrête, les derniers articles restent lisibles, mais ce flux ne reçoit plus de nouveautés.

## Hébergement avec Docker

Le dossier `deploy/` contient une image Docker, une configuration Compose et un reverse proxy Caddy. Exemple avec un domaine que vous contrôlez :

```bash
RSS_DOMAIN=rss.exemple.be docker compose -f deploy/compose.yaml up -d --build
npm run verify -- https://rss.exemple.be
```

Ce mode demande un DNS pointant vers le serveur et des ports 80/443 accessibles. Le cache est conservé dans le volume `rss_data`.

## Repères dans le code

- `src/collect.js`, `src/providers.js`, `src/fisconet.js` : récupération et normalisation des sources ;
- `src/content.js`, `src/importance-filter.js` : contenu des articles et filtre de veille ;
- `src/feeds.js`, `src/http.js` : génération et diffusion RSS ;
- `src/server.js`, `src/worker.js` : hébergements Node et Cloudflare ;
- `test/fixtures/` : réponses officielles conservées pour les tests ;
- `AUDIT.md` : étude des sources et choix techniques ;
- `VALIDATION.md` : contrôles réalisés sur l'instance de référence.

## Limites connues

Les sites sources peuvent changer leur structure ou limiter les requêtes. Le dernier cache valide reste disponible en cas d'échec ; la route `/health` expose l'état de chaque collecte. Les tests automatisés utilisent des réponses enregistrées : ils vérifient le traitement du contenu, sans garantir l'accès actuel aux sites officiels depuis un nouvel hébergement.
