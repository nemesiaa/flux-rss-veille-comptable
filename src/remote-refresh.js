/* Programme: Actualites publiques - Controle de collecte sur l hebergement public
   Date: 2026-09-14 - Auteur: nemesiaa
   Execution: npm run cloud:refresh -- https://actualites.<compte>.workers.dev
   Lit RSS_REFRESH_TOKEN dans .env ou l environnement, sans jamais l afficher.
   Ne produit aucun fichier local; met a jour le cache distant via une route authentifiee.
   Le meme secret doit etre configure sous REFRESH_TOKEN dans Cloudflare.
   Code 1 si une source echoue; le dernier cache reste alors disponible. */
// Origine explicite du service deploye; aucun endpoint fournisseur n est fourni par l utilisateur.
const base=process.argv[2];
// Secret reserve a l exploitation, exclu de toute sortie et du depot.
const token=process.env.RSS_REFRESH_TOKEN;
if(!base||new URL(base).protocol!=='https:'||!token)throw new Error('Indiquer une origine HTTPS et configurer RSS_REFRESH_TOKEN localement.');
// Appel manuel du meme collecteur que la tache horaire.
const response=await fetch(new URL('/admin/refresh',base),{method:'POST',headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(180000)});
if(!response.headers.get('content-type')?.includes('json'))throw new Error(`Collecte distante refusee: HTTP ${response.status}.`);
console.log(JSON.stringify(await response.json(),null,2));
if(!response.ok)process.exitCode=1;
