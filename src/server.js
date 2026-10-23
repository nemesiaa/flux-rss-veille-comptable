/* Programme: Actualites publiques - Serveur Express autonome
   Date: 2026-09-14 - Auteur: nemesiaa
   Installation: npm ci. Execution: npm start. Port 3190 par defaut.
   Produit data/inasti.json et data/spf-finances.json; actualisation au demarrage puis horaire.
   PUBLIC_BASE_URL fixe l origine publique HTTPS derriere le reverse proxy.
   Voir README.md pour Docker, HTTPS et les chemins des flux. */
import express from 'express';
import {sources} from './feeds.js';
import {refreshSource,logRefresh} from './collect.js';
import {sourceKey,feedResponse,statusResponse,readerResponse} from './http.js';
import {fileStore} from './store.js';
import {createBelgiumPublisher} from './publisher.js';

export function createApp(store,baseUrl) {
  // Adapter le meme handler RSS au protocole Express sans exposer le systeme de fichiers.
  const app=express();app.disable('x-powered-by');
  app.use(async(req,res)=>{
    // Un lecteur consulte seulement le cache, jamais la source en direct.
    try{
      const url=new URL(req.originalUrl,baseUrl);let response;
      if(!['GET','HEAD'].includes(req.method))response=new Response('Methode non autorisee',{status:405,headers:{Allow:'GET, HEAD'}});
      else if(url.pathname.startsWith('/lire/')&&sourceKey(`/rss/${url.pathname.slice(6)}.xml`)){
        const key=sourceKey(`/rss/${url.pathname.slice(6)}.xml`);response=readerResponse(key,await store.get(key));
      }else if(sourceKey(url.pathname)){
        const key=sourceKey(url.pathname);response=await feedResponse(new Request(url,{method:req.method,headers:req.headers}),key,await store.get(key));
      }else if(url.pathname==='/health'||url.pathname==='/'){
        const states={};for(const key of Object.keys(sources))states[key]=await store.get(key);
        response=statusResponse(states,new URL(baseUrl).origin);
      }else response=new Response('Flux inconnu',{status:404});
      res.status(response.status);for(const [key,value] of response.headers)res.setHeader(key,value);
      res.end(req.method==='HEAD'?undefined:Buffer.from(await response.arrayBuffer()));
    }catch(error){console.error('Lecture du cache RSS impossible:',error.message);res.status(503).send('Cache temporairement indisponible');}
  });
  return app;
}
export async function start() {
  // Demarrer le serveur et son ordonnanceur; aucun chevauchement des collectes locales.
  const port=Number(process.env.PORT||3190),store=fileStore(process.env.DATA_DIR||'data');
  const app=createApp(store,process.env.PUBLIC_BASE_URL||`http://127.0.0.1:${port}`);
  const publishBelgium=createBelgiumPublisher({origin:process.env.RSS_PUBLIC_ORIGIN,token:process.env.RSS_REFRESH_TOKEN});
  const enabled=process.env.RSS_RELAY_ONLY==='belgium'?['belgium']:Object.keys(sources);
  let running=false;
  async function refresh() {
    // Conserver les echecs par source sans interrompre les autres collectes.
    if(running)return;running=true;
    try{for(const key of enabled){
      try{const previous=await store.get(key),state=await refreshSource(key,previous);if(state!==previous)await store.put(key,state);logRefresh(key,state);if(key==='belgium')await publishBelgium(state);}
      catch(error){console.error(`Stockage ${key}: ${error.message}`);}
    }}finally{running=false;}
  }
  const server=app.listen(port,process.env.HOST||'127.0.0.1',()=>{
    // Annoncer les chemins locaux sans les presenter comme accessibles depuis Internet.
    console.log(`Actualites publiques: http://127.0.0.1:${port}/rss/inasti.xml et /rss/spf-finances.xml`);
  });
  await refresh();const timer=setInterval(refresh,60000);
  function stop() {
    // Liberer le port et arreter la planification sur arret normal du processus.
    clearInterval(timer);server.close();
  }
  process.once('SIGINT',stop);process.once('SIGTERM',stop);
  return {server,stop};
}
if(process.argv[1]&&import.meta.url===new URL(`file://${process.argv[1]}`).href)await start();
