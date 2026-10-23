/* Programme: Actualites publiques - Collecte manuelle et preparation du cache Cloudflare
   Date: 2026-09-14 - Auteur: nemesiaa
   Execution: npm run refresh. Ne pas lancer pendant une collecte du serveur local.
   Produit data/<source>.json, examples/<source>.xml et data/cloudflare-seed.json.
   Le fichier seed initialise Workers KV au deploiement; il ne contient aucun secret.
   En cas de panne, conserve le dernier succes, affiche l erreur et retourne le code 1. */
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {sources,renderRss,validateRss} from './feeds.js';
import {refreshSource,logRefresh} from './collect.js';
import {fileStore} from './store.js';

// Dossier persistant configurable, origine locale pour les exemples avant deploiement.
const directory=process.env.DATA_DIR||'data';
// Adaptateur partage avec le serveur Express.
const store=fileStore(directory);
// Donnees publiques a importer dans Workers KV.
const seed=[];
await mkdir('examples',{recursive:true});await mkdir(directory,{recursive:true});
for(const key of Object.keys(sources)){
  const previous=await store.get(key),state=await refreshSource(key,previous,{force:true});
  await store.put(key,state);logRefresh(key,state);
  if(state.error)process.exitCode=1;
  if(state.items.length){
    const xml=renderRss(key,state,process.env.PUBLIC_BASE_URL||'http://127.0.0.1:3190');
    console.log(key,validateRss(xml));await writeFile(`examples/${key}.xml`,xml);
    seed.push({key:`feed:${key}`,value:JSON.stringify(state)});
  }
}
await writeFile(join(directory,'cloudflare-seed.json'),JSON.stringify(seed,null,2));
