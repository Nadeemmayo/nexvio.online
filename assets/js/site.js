(function(){
"use strict";
var S=window.SITE||{};
function $(s,r){return (r||document).querySelector(s)}
function $$(s,r){return Array.prototype.slice.call((r||document).querySelectorAll(s))}
function esc(t){return String(t==null?"":t).replace(/[&<>"']/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]})}
function wa(msg){return "https://wa.me/"+S.wa+"?text="+encodeURIComponent(msg)}

/* menu */
var burger=$(".burger"),nav=$(".nav");
if(burger&&nav){burger.addEventListener("click",function(){var o=nav.classList.toggle("show");burger.setAttribute("aria-expanded",o);burger.innerHTML=o?'<i class="fas fa-xmark"></i>':'<i class="fas fa-bars"></i>';document.body.style.overflow=o?"hidden":""})}
$$(".dd").forEach(function(dd){
 var b=dd.querySelector("button"),t;
 b.addEventListener("click",function(e){e.stopPropagation();var o=dd.classList.toggle("open");b.setAttribute("aria-expanded",o)});
 if(window.matchMedia("(min-width:1081px)").matches){
  dd.addEventListener("mouseenter",function(){clearTimeout(t);dd.classList.add("open");b.setAttribute("aria-expanded","true")});
  dd.addEventListener("mouseleave",function(){t=setTimeout(function(){dd.classList.remove("open");b.setAttribute("aria-expanded","false")},180)});
 }
});
document.addEventListener("click",function(e){$$(".dd.open").forEach(function(d){if(!d.contains(e.target)&&!(nav&&nav.classList.contains("show")))d.classList.remove("open")})});
document.addEventListener("keydown",function(e){if(e.key==="Escape"){$$(".dd.open").forEach(function(d){d.classList.remove("open")});var p=$(".ai-panel");if(p)p.classList.remove("open")}});

/* reveal */
var rv=$$(".rv");
if("IntersectionObserver" in window){var io=new IntersectionObserver(function(es){es.forEach(function(x){if(x.isIntersecting){x.target.classList.add("in");io.unobserve(x.target)}})},{rootMargin:"0px 0px -40px 0px"});rv.forEach(function(el){io.observe(el)})}else rv.forEach(function(el){el.classList.add("in")});

/* year */
$$("[data-year]").forEach(function(el){el.textContent=new Date().getFullYear()});

/* contact form: also offer WhatsApp */
$$("form[data-wa]").forEach(function(f){
 var btn=f.querySelector("[data-wa-send]");
 if(btn)btn.addEventListener("click",function(){
  var d=new FormData(f),lines=[S.name+" enquiry"];
  d.forEach(function(v,k){if(k.charAt(0)!=="_"&&v)lines.push(k+": "+v)});
  window.open(wa(lines.join("\n")),"_blank","noopener");
 });
});

/* inventory */
var inv=$("#inv");
if(inv){
 var state={q:"",niche:inv.dataset.niche||"",dr:+(inv.dataset.dr||0),da:0,tr:0,sort:"dr",page:1},rows=[],per=25;
 var params=new URLSearchParams(location.search);if(params.get("niche"))state.niche=params.get("niche");
 fetch("/data/publishers.json").then(function(r){return r.json()}).then(function(d){
  rows=d.map(function(a){return{d:a[0],n:a[1],s:a[2],c:a[3],da:a[4],dr:a[5],t:a[6],gp:a[7],ne:a[8],pr:a[9],df:a[10],tat:a[11]}});
  buildChips();bind();render();
 }).catch(function(){$("#inv-body").innerHTML='<tr><td colspan="7">The list could not load. Please message us on WhatsApp for the full inventory.</td></tr>'});
 function fmt(n){if(!n)return"–";if(n>=1e6)return(n/1e6).toFixed(n>=1e7?0:1)+"M";if(n>=1e3)return Math.round(n/1e3)+"K";return n}
 function buildChips(){
  var c={};rows.forEach(function(r){c[r.n]=(c[r.n]||0)+1});
  var keys=Object.keys(c).sort(function(a,b){return c[b]-c[a]}).slice(0,14);
  var el=$("#inv-chips");if(!el)return;
  el.innerHTML='<button class="chip'+(state.niche?"":" on")+'" data-n="">All<em>'+rows.length+'</em></button>'+keys.map(function(k){return '<button class="chip'+(state.niche===k?" on":"")+'" data-n="'+esc(k)+'">'+esc(k)+'<em>'+c[k]+'</em></button>'}).join("");
  $$(".chip",el).forEach(function(b){b.addEventListener("click",function(){state.niche=b.dataset.n;state.page=1;$$(".chip",el).forEach(function(x){x.classList.toggle("on",x===b)});render()})});
 }
 function bind(){
  var q=$("#inv-q");q&&q.addEventListener("input",function(){state.q=q.value.toLowerCase();state.page=1;render()});
  [["#inv-dr","dr"],["#inv-da","da"],["#inv-tr","tr"],["#inv-sort","sort"]].forEach(function(p){var el=$(p[0]);if(el){if(p[1]==="dr"&&state.dr)el.value=state.dr;el.addEventListener("change",function(){state[p[1]]=p[1]==="sort"?el.value:+el.value;state.page=1;render()})}});
 }
 function render(){
  var list=rows.filter(function(r){
   if(state.niche&&r.n!==state.niche)return false;
   if(r.dr<state.dr||r.da<state.da||r.t<state.tr)return false;
   if(state.q&&(r.d+" "+r.n+" "+r.s).toLowerCase().indexOf(state.q)<0)return false;return true});
  list.sort(function(a,b){return state.sort==="az"?a.d.localeCompare(b.d):(b[state.sort]||0)-(a[state.sort]||0)});
  var pages=Math.max(1,Math.ceil(list.length/per));if(state.page>pages)state.page=pages;
  var slice=list.slice((state.page-1)*per,state.page*per);
  $("#inv-count").textContent=list.length.toLocaleString()+" publishers match";
  $("#inv-body").innerHTML=slice.length?slice.map(function(r){
   var types=[r.gp?"Guest post":"",r.ne?"Niche edit":"",r.pr?"Digital PR":""].filter(Boolean);if(!types.length)types=["Placement"];
   var m="Hi "+S.name+", please share the price for "+r.d+" ("+r.n+").";
   return '<tr><td class="dom">'+esc(r.d)+'<small>'+esc(r.s||r.c)+'</small></td><td>'+esc(r.n)+'</td><td><span class="m'+(r.dr>=70?" hi":"")+'">'+(r.dr||"–")+'</span></td><td><span class="m'+(r.da>=70?" hi":"")+'">'+(r.da||"–")+'</span></td><td>'+fmt(r.t)+'</td><td>'+types.map(function(t){return'<span class="tag">'+t+'</span>'}).join("")+(r.df?'<span class="tag">Dofollow</span>':"")+'</td><td>'+esc(r.tat||"On request")+'</td><td><div class="ask"><a class="wa" target="_blank" rel="noopener" href="'+wa(m)+'"><i class="fab fa-whatsapp"></i> Request price</a><a class="em" href="mailto:'+S.email+'?subject='+encodeURIComponent("Price request: "+r.d)+'&body='+encodeURIComponent(m)+'" aria-label="Email for '+esc(r.d)+'"><i class="far fa-envelope"></i></a></div></td></tr>'
  }).join(""):'<tr><td colspan="8">No publishers match these filters. Message us and we will source matching sites.</td></tr>';
  var pg=$("#inv-pager"),h="";
  if(pages>1){h+='<button '+(state.page===1?"disabled":"")+' data-p="'+(state.page-1)+'" aria-label="Previous page">‹</button>';
   var a=Math.max(1,state.page-2),b=Math.min(pages,a+4);a=Math.max(1,b-4);
   for(var i=a;i<=b;i++)h+='<button class="'+(i===state.page?"on":"")+'" data-p="'+i+'">'+i+'</button>';
   h+='<button '+(state.page===pages?"disabled":"")+' data-p="'+(state.page+1)+'" aria-label="Next page">›</button>'}
  pg.innerHTML=h;$$("button",pg).forEach(function(b){b.addEventListener("click",function(){state.page=+b.dataset.p;render();inv.scrollIntoView({behavior:"smooth",block:"start"})})});
 }
}

/* contact toggle */
var ctb=$(".ct-btn"),ctm=$("#ct-menu");
if(ctb&&ctm){ctb.addEventListener("click",function(e){e.stopPropagation();var o=ctm.hidden;ctm.hidden=!o;ctb.setAttribute("aria-expanded",o);ctb.innerHTML=o?'<i class="fas fa-xmark"></i>':'<i class="fas fa-comment-dots"></i>'});
 document.addEventListener("click",function(e){if(!ctm.hidden&&!ctm.contains(e.target)){ctm.hidden=true;ctb.setAttribute("aria-expanded","false");ctb.innerHTML='<i class="fas fa-comment-dots"></i>'}})}

/* AI concierge */
var KB=window.KB||[];
var fab=$(".ai-fab"),panel=$(".ai-panel");
if(fab&&panel){
 var log=$(".ai-log",panel),inp=$(".ai-in input",panel),greeted=false;
 function say(html,who){var m=document.createElement("div");m.className="ai-msg "+(who||"bot");m.innerHTML=html;log.appendChild(m);log.scrollTop=log.scrollHeight}
 function open(){panel.classList.add("open");fab.setAttribute("aria-expanded","true");if(!greeted){greeted=true;say(S.greet)}setTimeout(function(){inp.focus()},50)}
 fab.addEventListener("click",function(){panel.classList.contains("open")?(panel.classList.remove("open"),fab.setAttribute("aria-expanded","false")):open()});
 $(".ai-head button",panel).addEventListener("click",function(){panel.classList.remove("open");fab.setAttribute("aria-expanded","false")});
 var stop={the:1,a:1,an:1,and:1,or:1,to:1,of:1,for:1,in:1,on:1,is:1,are:1,do:1,does:1,you:1,your:1,i:1,me:1,my:1,we:1,can:1,what:1,how:1,with:1,it:1,be:1,about:1,please:1};
 function toks(t){return t.toLowerCase().replace(/[^a-z0-9 ]/g," ").split(/\s+/).filter(function(w){return w.length>1&&!stop[w]})}
 function answer(q){
  var qt=toks(q),best=null,bs=0;
  KB.forEach(function(k){var kt=toks(k.k+" "+k.q),s=0;qt.forEach(function(w){kt.forEach(function(x){if(x===w)s+=2;else if(x.length>3&&w.length>3&&(x.indexOf(w)===0||w.indexOf(x)===0))s+=1})});if(s>bs){bs=s;best=k}});
  if(best&&bs>=2){say(esc(best.a)+(best.l?' <a href="'+best.l+'">Learn more →</a>':""))}
  else say("I want to get this right, so let me pass you to "+esc(S.founder)+" directly. <a target=\"_blank\" rel=\"noopener\" href=\""+wa("Hi "+S.name+", "+q)+"\">Continue on WhatsApp →</a>");
 }
 function ask(q){if(!q.trim())return;say(esc(q),"me");setTimeout(function(){answer(q)},280)}
 $(".ai-in",panel).addEventListener("submit",function(e){e.preventDefault();ask(inp.value);inp.value=""});
 $$(".ai-chips button",panel).forEach(function(b){b.addEventListener("click",function(){ask(b.textContent)})});
}
})();
