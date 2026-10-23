/* Programme: Actualites publiques - Stockage disque pour auto-hebergement Node
   Date: 2026-09-14 - Auteur: nemesiaa */
import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {sources} from './feeds.js';
export function fileStore(directory) {
  // Une instance de serveur par repertoire; fichiers distincts pour chaque source.
  return {
    async get(key) {
      // Refuser les chemins libres et ignorer uniquement une absence de cache initial.
      if(!Object.hasOwn(sources,key))throw new Error('Source inconnue.');
      try{return JSON.parse(await readFile(join(directory,`${key}.json`),'utf8'));}
      catch(error){if(error.code==='ENOENT')return null;throw error;}
    },
    async put(key,state) {
      // Remplacer atomiquement le cache apres ecriture complete.
      if(!Object.hasOwn(sources,key))throw new Error('Source inconnue.');
      await mkdir(directory,{recursive:true});
      const temp=join(directory,`${key}.${randomUUID()}.tmp`);
      await writeFile(temp,JSON.stringify(state,null,2));await rename(temp,join(directory,`${key}.json`));
    },
  };
}
