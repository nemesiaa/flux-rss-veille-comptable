/* Programme: Actualites publiques - Relais personnel Belgium.be
   Date: 2026-09-14 - Auteur: nemesiaa
   Utilise par npm start lorsque RSS_PUBLIC_ORIGIN et RSS_REFRESH_TOKEN sont definis.
   Publie uniquement un flux officiel deja valide; aucun mot de passe Cloudflare requis.
   En cas de panne reseau, nouvelle tentative apres cinq minutes, sans perte du cache. */
import {renderRss} from './feeds.js';
export function createBelgiumPublisher({origin,token,fetcher=fetch,clock=Date.now}) {
  // Memoriser les succes pour eviter une ecriture distante a chaque consultation locale.
  let published=null,nextTry=0;
  return async(state)=>{
    // Le relais reste desactive en auto-hebergement ordinaire sans configuration cloud.
    if(!origin||!token||state.error||!state.items?.length||published===state.lastSuccess||clock()<nextTry)return false;
    nextTry=clock()+300000;
    try{
      const url=new URL('/admin/publish-belgium',origin);
      if(url.protocol!=='https:')throw new Error('Le relais exige HTTPS.');
      const response=await fetcher(url,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/rss+xml; charset=utf-8','X-Collected-At':state.lastSuccess},
        body:renderRss('belgium',state,origin),signal:AbortSignal.timeout(30000)});
      if(!response.ok)throw new Error(`HTTP ${response.status}`);
      await response.body?.cancel();published=state.lastSuccess;nextTry=0;
      console.log(JSON.stringify({relay:'belgium',publishedAt:new Date(clock()).toISOString(),sourceDate:state.lastSuccess}));
      return true;
    }catch(error){console.error(`Relais Belgium.be: ${error.message}; nouvelle tentative dans cinq minutes.`);return false;}
  };
}
