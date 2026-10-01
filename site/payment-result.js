(function(){
"use strict";
var q=new URLSearchParams(location.search),cancel=q.get("status")==="cancelled";
if(cancel){
 var b=document.getElementById("payment-badge"),t=document.getElementById("payment-title"),p=document.getElementById("payment-text");
 if(b){b.textContent="PAIEMENT NON FINALISÉ";b.classList.add("cancel")}
 if(t)t.textContent="Le paiement n’a pas été finalisé.";
 if(p)p.textContent="Aucun message affiché sur cette page ne vaut confirmation de débit. Vous pouvez fermer cette page et contacter directement le professionnel si nécessaire.";
}
try{history.replaceState(null,"",location.pathname+"?status="+(cancel?"cancelled":"success"))}catch(_e){}
})();