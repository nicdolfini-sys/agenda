import '@fontsource/comfortaa/latin-400.css';
import '@fontsource/comfortaa/latin-500.css';
import '@fontsource/comfortaa/latin-600.css';
import '@fontsource/comfortaa/latin-700.css';
import './styles.css';
import {generatePalettes,DEFAULT_LIGHTNESS} from 'nicrainha';
import {invalidateScene} from './scene';
import cat from './rolling-cat.gif';

// ── dados (formato gerado por scripts/sync.py) ─────────────────────────────
interface Item {
 origem:'moodle'|'google';tipo:string;titulo:string;disciplina?:string;local?:string|null;
 quando:number|string|null;fim?:number|string|null;diaTodo?:boolean;entregue?:boolean;link?:string;
}
interface Dados {nome:string;atualizado:number;moodle:string;disciplinas:{nome:string}[];itens:Item[];}
interface Pacote {v:number;iter:number;sal:string;iv:string;dados:string;}

const app=document.querySelector<HTMLElement>('#app')!;
const b64=(s:string)=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
const esc=(s:unknown)=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]!));
const LS={
 get<T>(k:string,d:T):T{try{const v=localStorage.getItem('planner.'+k);return v===null?d:JSON.parse(v)}catch{return d}},
 set(k:string,v:unknown){try{localStorage.setItem('planner.'+k,JSON.stringify(v))}catch{}},
 del(k:string){try{localStorage.removeItem('planner.'+k)}catch{}},
};

async function baixar():Promise<Pacote> {
 const r=await fetch(`data.enc.json?t=${Date.now()}`,{cache:'no-store'});
 if(!r.ok)throw new Error(`não achei os dados (${r.status})`);
 return r.json();
}
async function abrir(senha:string,p:Pacote):Promise<Dados> {
 const base=await crypto.subtle.importKey('raw',new TextEncoder().encode(senha),'PBKDF2',false,['deriveKey']);
 const chave=await crypto.subtle.deriveKey({name:'PBKDF2',hash:'SHA-256',salt:b64(p.sal),iterations:p.iter},base,{name:'AES-GCM',length:256},false,['decrypt']);
 const pt=await crypto.subtle.decrypt({name:'AES-GCM',iv:b64(p.iv)},chave,b64(p.dados));
 return JSON.parse(new TextDecoder().decode(pt));
}

// ── datas ──────────────────────────────────────────────────────────────────
const DIAS=['dom','seg','ter','qua','qui','sex','sáb'];
const MESES=['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
const inicioDia=(d:Date)=>{const x=new Date(d);x.setHours(0,0,0,0);return x};
const addDias=(d:Date,n:number)=>{const x=new Date(d);x.setDate(x.getDate()+n);return x};
const segunda=(d:Date)=>addDias(inicioDia(d),-((d.getDay()+6)%7));
const mesmoDia=(a:Date,b:Date)=>a.toDateString()===b.toDateString();
const p2=(n:number)=>String(n).padStart(2,'0');
const hh=(d:Date)=>`${p2(d.getHours())}:${p2(d.getMinutes())}`;
const curta=(d:Date)=>`${DIAS[d.getDay()]} ${p2(d.getDate())}/${p2(d.getMonth()+1)}`;
function data(v:number|string|null|undefined):Date|null {
 if(v==null)return null;
 if(typeof v==='string'){const [y,m,d]=v.split('-').map(Number);return new Date(y,m-1,d)}
 return new Date(v*1000);
}

// ── estado ─────────────────────────────────────────────────────────────────
let D:Dados;
let vista=LS.get<'semana'|'mes'|'lista'>('vista','semana');
let feitos=LS.get('feitos',false);
const ocultos=new Set(LS.get<string[]>('ocultos',[]));
const desligadas=new Set(LS.get<string[]>('desligadas',[]));
let semana0=segunda(new Date());
let mes0=new Date(new Date().getFullYear(),new Date().getMonth(),1);
let diaSel=inicioDia(new Date());
const cores=new Map<string,string>();

const grupo=(it:Item)=>it.origem==='google'?'Pessoal':(it.disciplina||'Outros');
const cor=(it:Item)=>cores.get(grupo(it))??'#ccc';
const chave=(it:Item)=>`${it.origem}|${it.link??''}|${it.titulo}|${it.quando}`;
const prazo=(it:Item)=>it.origem==='moodle'&&it.tipo!=='evento';
const atrasado=(it:Item)=>{const d=data(it.quando);return !!d&&prazo(it)&&!it.entregue&&d<new Date()};
const visiveis=()=>D.itens.filter(it=>!desligadas.has(grupo(it))&&(feitos||!it.entregue));

function noDia(lista:Item[],dia:Date):Item[] {
 return lista.filter(it=>{
  const d=data(it.quando);if(!d)return false;
  if(mesmoDia(d,dia))return true;
  const f=data(it.fim);return !!f&&d<dia&&f>dia; // eventos de vários dias
 }).sort((a,b)=>Number(!a.diaTodo)-Number(!b.diaTodo)||+data(a.quando)!-+data(b.quando)!);
}

function gcal(it:Item):string {
 const q=new URLSearchParams({action:'TEMPLATE',text:`${it.titulo}${it.disciplina?' — '+it.disciplina:''}`,details:it.link??''});
 const d=data(it.quando);
 if(d){const f=(x:Date)=>x.toISOString().replace(/[-:]|\.\d{3}/g,'');q.set('dates',`${f(d)}/${f(new Date(+d+30*60e3))}`)}
 return `https://calendar.google.com/calendar/render?${q}`;
}

// ── peças ──────────────────────────────────────────────────────────────────
function linha(it:Item,{ocultavel=false}={}):string {
 const d=data(it.quando);
 const quando=d?(it.diaTodo?curta(d):`${curta(d)} ${hh(d)}`):'sem data';
 const tags=(atrasado(it)?'<span class="tag late">atrasado</span>':'')+(it.entregue?'<span class="tag ok">entregue</span>':'');
 const onde=it.origem==='moodle'?it.disciplina:(it.local||'pessoal');
 const acts=it.origem==='moodle'?`<div class="acts">
   ${it.link?`<a class="act" href="${esc(it.link)}" target="_blank" rel="noopener" title="abrir no Moodle">↗</a>`:''}
   <a class="act" href="${esc(gcal(it))}" target="_blank" rel="noopener" title="pôr no Google Agenda">+</a>
   ${ocultavel?`<button class="act" data-ocultar="${esc(chave(it))}" title="ocultar daqui">×</button>`:''}</div>`:'';
 return `<div class="item ${it.entregue?'done':''}"><span class="swatch" style="background:${cor(it)}"></span>
  <div class="t">${esc(it.titulo)}${tags}</div>${acts}<div class="meta">${esc(quando)} · ${esc(onde)}</div></div>`;
}
const bloco=(it:Item)=>{const d=data(it.quando)!;
 return `<div class="ev ${it.entregue?'done':''}" style="--c:${cor(it)}" title="${esc(grupo(it))}"><b>${esc(it.titulo)}</b><span>${it.diaTodo?'dia todo':hh(d)}${it.origem==='moodle'?' · '+esc(abreviar(it.disciplina??'')):''}</span></div>`};
const abreviar=(s:string)=>s.split(/\s+/).filter(w=>w.length>2&&!/^(de|da|do|dos|das)$/i.test(w)).map(w=>/^[IVX]+$/.test(w)?w:w[0].toUpperCase()).join('');

function atencao():string {
 const agora=new Date(),lim=addDias(agora,7);
 const base=D.itens.filter(it=>!desligadas.has(grupo(it)));
 const prox=base.filter(it=>{const d=data(it.quando);return !it.entregue&&d&&d>=agora&&d<=lim}).sort((a,b)=>+data(a.quando)!-+data(b.quando)!);
 const late=base.filter(it=>atrasado(it)&&!ocultos.has(chave(it)));
 let h=`<section class="panel glass" data-glass><h2>Atenção</h2><h3>Próximos 7 dias</h3>${prox.map(i=>linha(i)).join('')||'<div class="empty">nada nos próximos 7 dias</div>'}`;
 if(late.length)h+=`<h3>Passou do prazo e não consta entrega</h3>${late.map(i=>linha(i,{ocultavel:true})).join('')}<div class="note">Se foi feito em sala ou não precisava, toque em × para ocultar.</div>`;
 return h+'</section>';
}

function vSemana():string {
 const lista=visiveis(),hoje=inicioDia(new Date()),fim=addDias(semana0,6);
 let h=`<div class="nav"><button class="bubble glass" data-glass data-go="-7">←</button><span class="label">${p2(semana0.getDate())}/${p2(semana0.getMonth()+1)} – ${p2(fim.getDate())}/${p2(fim.getMonth()+1)}</span><button class="bubble glass" data-glass data-go="hoje">hoje</button><button class="bubble glass" data-glass data-go="7">→</button></div><div class="sheet week">`;
 for(let i=0;i<7;i++){
  const dia=addDias(semana0,i);
  h+=`<div class="day ${mesmoDia(dia,hoje)?'today':''}"><div class="day-head"><span>${DIAS[dia.getDay()]}</span><b>${p2(dia.getDate())}</b></div><div class="day-body">${noDia(lista,dia).map(bloco).join('')}</div></div>`;
 }
 return h+'</div>';
}

function vMes():string {
 const lista=visiveis(),hoje=inicioDia(new Date()),ini=segunda(mes0);
 let h=`<div class="nav"><button class="bubble glass" data-glass data-mes="-1">←</button><span class="label">${MESES[mes0.getMonth()]} ${mes0.getFullYear()}</span><button class="bubble glass" data-glass data-mes="0">hoje</button><button class="bubble glass" data-glass data-mes="1">→</button></div><div class="sheet"><div class="month">`;
 h+=['seg','ter','qua','qui','sex','sáb','dom'].map(d=>`<div class="wd">${d}</div>`).join('');
 for(let i=0;i<42;i++){
  const dia=addDias(ini,i);if(i===35&&dia.getMonth()!==mes0.getMonth())break;
  const its=noDia(lista,dia);
  h+=`<button class="cell ${dia.getMonth()!==mes0.getMonth()?'out':''} ${mesmoDia(dia,hoje)?'today':''} ${mesmoDia(dia,diaSel)?'sel':''}" data-dia="${+dia}"><span class="n">${dia.getDate()}</span>`
   +its.slice(0,3).map(it=>`<span class="bar" style="--c:${cor(it)}">${esc(it.titulo)}</span>`).join('')
   +(its.length>3?`<span class="more">+${its.length-3}</span>`:'')
   +`<span class="dots">${its.map(it=>`<i style="--c:${cor(it)}"></i>`).join('')}</span></button>`;
 }
 const sel=noDia(lista,diaSel);
 return h+`</div><div class="day-detail"><h3>${curta(diaSel)}</h3>${sel.map(i=>linha(i)).join('')||'<div class="empty">dia livre</div>'}</div></div>`;
}

function vLista():string {
 const lista=visiveis(),hoje=inicioDia(new Date());
 const futuros=lista.filter(it=>{const d=data(it.quando);return d&&d>=hoje}).sort((a,b)=>+data(a.quando)!-+data(b.quando)!);
 const porDisc=new Map<string,Item[]>();
 for(const it of lista)if(!data(it.quando))porDisc.set(grupo(it),[...(porDisc.get(grupo(it))??[]),it]);
 let h=`<div class="sheet sheet-pad"><h3 style="margin-top:16px">Daqui pra frente</h3>${futuros.map(i=>linha(i)).join('')||'<div class="empty">nada marcado</div>'}</div>`;
 h+=`<div class="sheet sheet-pad" style="margin-top:16px"><h3 style="margin-top:16px">Sem prazo no Moodle</h3><div class="note" style="margin:0 0 6px">Toque em + para pôr no Google Agenda com a data combinada em sala.</div>`;
 for(const [g,its] of porDisc)h+=`<h3>${esc(g)}</h3>${its.map(i=>linha(i)).join('')}`;
 return h+(porDisc.size?'':'<div class="empty">tudo com data</div>')+'<div style="height:12px"></div></div>';
}

// ── telas ──────────────────────────────────────────────────────────────────
function render():void {
 const scroll=app.querySelector<HTMLElement>('.scroll')?.scrollTop??0;
 const primeiro=(D.nome||'').split(' ')[0];
 const at=new Date(D.atualizado*1000),hoje=new Date();
 const grupos=[...D.disciplinas.map(d=>d.nome),...(D.itens.some(i=>i.origem==='google')?['Pessoal']:[])];
 app.innerHTML=`
 <header class="banner"><span class="wordmark">Planner.</span><nav class="bubbles">
  <a class="bubble glass" data-glass href="${esc(D.moodle)}" target="_blank" rel="noopener">Moodle ↗</a>
  <a class="bubble glass wide" data-glass href="https://calendar.google.com/calendar/r/eventedit" target="_blank" rel="noopener">+ pessoal ↗</a>
  <button class="bubble glass" data-glass id="sair" title="esquecer a senha neste aparelho">Sair</button></nav></header>
 <div class="scroll"><main class="content">
  <div><h1>Olá, ${esc(primeiro)}</h1><div class="note" style="margin-top:6px">${DIAS[hoje.getDay()]}, ${hoje.getDate()} de ${MESES[hoje.getMonth()]} · Moodle lido em ${curta(at)} ${hh(at)}</div></div>
  ${atencao()}
  <div class="toolbar">
   ${(['semana','mes','lista'] as const).map(v=>`<button class="bubble glass ${vista===v?'':'off'}" data-glass data-vista="${v}">${{semana:'Semana',mes:'Mês',lista:'Lista'}[v]}</button>`).join('')}
   <span class="spacer"></span>
   <button class="bubble glass ${feitos?'':'off'}" data-glass id="feitos" aria-pressed="${feitos}">${feitos?'✓ ':''}Entregues</button>
  </div>
  <div class="chips">${grupos.map(g=>`<button class="chip glass ${desligadas.has(g)?'off':''}" data-glass data-grupo="${esc(g)}"><span class="swatch" style="background:${cores.get(g)}"></span>${esc(g)}</button>`).join('')}</div>
  <section class="panel glass" data-glass>${{semana:vSemana,mes:vMes,lista:vLista}[vista]()}</section>
 </main></div>`;
 app.querySelector<HTMLElement>('.scroll')!.scrollTop=scroll;
 invalidateScene();
}

app.addEventListener('click',e=>{
 const t=(e.target as Element).closest<HTMLElement>('button');if(!t||!D)return;
 const ds=t.dataset;
 if(t.id==='sair'){LS.del('senha');location.reload();return}
 if(t.id==='feitos'){feitos=!feitos;LS.set('feitos',feitos)}
 else if(ds.vista){vista=ds.vista as typeof vista;LS.set('vista',vista)}
 else if(ds.grupo){desligadas.has(ds.grupo)?desligadas.delete(ds.grupo):desligadas.add(ds.grupo);LS.set('desligadas',[...desligadas])}
 else if(ds.ocultar){ocultos.add(ds.ocultar);LS.set('ocultos',[...ocultos])}
 else if(ds.go){semana0=ds.go==='hoje'?segunda(new Date()):addDias(semana0,+ds.go)}
 else if(ds.mes){mes0=ds.mes==='0'?new Date(new Date().getFullYear(),new Date().getMonth(),1):new Date(mes0.getFullYear(),mes0.getMonth()+ +ds.mes,1);if(ds.mes==='0')diaSel=inicioDia(new Date())}
 else if(ds.dia){diaSel=new Date(+ds.dia)}
 else return;
 render();
});

function carregando(on:boolean):void {
 document.querySelector('.loading')?.remove();
 if(on)document.body.insertAdjacentHTML('beforeend',`<div class="loading"><img src="${cat}" alt=""><p>abrindo<span>.</span><span>.</span><span>.</span></p></div>`);
}

function montar(dados:Dados):void {
 D=dados;
 const grupos=[...D.disciplinas.map(d=>d.nome),'Pessoal'];
 // Cores do nicrainha, igualmente espaçadas no círculo de matizes, como no netsy.
 const pal=generatePalettes(grupos.length,{lightness:DEFAULT_LIGHTNESS})[0];
 grupos.forEach((g,i)=>cores.set(g,`rgb(${pal[i].r} ${pal[i].g} ${pal[i].b})`));
 render();
}

function cadeado(pacote:Pacote|null,erro=''):void {
 app.innerHTML=`<div class="lock"><span class="wordmark">Planner.</span><form class="lock-card glass" data-glass autocomplete="on">
  <h1>Senha</h1>
  <input type="text" name="username" value="nicolle" autocomplete="username" hidden>
  <input type="password" id="senha" autocomplete="current-password" aria-label="senha" autofocus>
  <label><input type="checkbox" id="lembrar" checked> lembrar neste aparelho</label>
  <div class="lock-error">${esc(erro)}</div>
  <button class="begin" type="submit">Abrir <span>→</span></button></form></div>`;
 invalidateScene();
 app.querySelector('form')!.addEventListener('submit',async ev=>{
  ev.preventDefault();
  const senha=app.querySelector<HTMLInputElement>('#senha')!.value,lembrar=app.querySelector<HTMLInputElement>('#lembrar')!.checked;
  carregando(true);
  try{
   let dados:Dados;
   try{pacote??=await baixar();dados=await abrir(senha,pacote)}
   catch{pacote=await baixar();dados=await abrir(senha,pacote)} // os dados podem ter mudado depois que a página abriu
   if(lembrar)LS.set('senha',senha);
   carregando(false);montar(dados);
  }catch{carregando(false);cadeado(pacote,'senha errada')}
 });
}

(async()=>{
 let pacote:Pacote|null=null;
 try{pacote=await baixar()}catch(e){cadeado(null,(e as Error).message);return}
 const salva=LS.get<string|null>('senha',null);
 if(salva){
  carregando(true);
  try{const d=await abrir(salva,pacote);carregando(false);montar(d);return}catch{LS.del('senha')}
  carregando(false);
 }
 cadeado(pacote);
})();
