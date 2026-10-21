// Fundo animado + vidro, como no netsy e no site de estudos (hcubasd/nicolle).
// Todo elemento com [data-glass] visível vira um painel de vidro; a rolagem
// de .scroll arrasta o fundo junto.
import {syncViewport} from './viewport';
import {createRenderer,type GlassPanel} from './engine/renderer.js';
const canvas=document.querySelector<HTMLCanvasElement>('#background')!;
const reduced=matchMedia('(prefers-reduced-motion: reduce)');
let renderer:ReturnType<typeof createRenderer>|undefined;
let lastFrame=performance.now(),lastDraw=-Infinity,dirty=true;
const pan={x:0,y:0};
let scrollElement:HTMLElement|null=null,scrollTop=0;
const panels:GlassPanel[]=[];
const pool:GlassPanel[]=Array.from({length:160},()=>({x:0,y:0,halfWidth:0,halfHeight:0,radius:28}));
export const LIGHTNESS=87;
let frozenTime=performance.now();
export function invalidateScene():void {dirty=true;}
function launch():void {
 try {
  renderer?.dispose();renderer=createRenderer(canvas,LIGHTNESS);
  document.documentElement.style.setProperty('--paper',renderer.themeColor);
  document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')!.content=renderer.themeColor;
  document.documentElement.classList.remove('no-webgl');
 }catch(error){renderer=undefined;document.documentElement.classList.add('no-webgl');console.warn('WebGL fallback:',error);}
 dirty=true;
}
function lost(event:Event):void {event.preventDefault();renderer?.dispose();renderer=undefined;document.documentElement.classList.add('no-webgl');}
function motion():void {frozenTime=performance.now();dirty=true;}
function frame(now:number):void {
 const dt=Math.min(64,now-lastFrame);lastFrame=now;
 if(syncViewport())dirty=true;
 const currentScroll=document.querySelector<HTMLElement>('#app .scroll');
 if(currentScroll===scrollElement){const top=currentScroll?.scrollTop??0;if(top!==scrollTop){pan.y+=top-scrollTop;dirty=true;}scrollTop=top;}
 else {scrollElement=currentScroll;scrollTop=currentScroll?.scrollTop??0;}
 if(!document.hidden&&(dirty||(!reduced.matches&&now-lastDraw>=(renderer?.interval??16)-dt/2))) {
  panels.length=0;
  const canvasRect=canvas.getBoundingClientRect();
  for(const el of document.querySelectorAll<HTMLElement>('[data-glass]')) {
   const rect=el.getBoundingClientRect();if(rect.width<=0||rect.height<=0||rect.bottom<canvasRect.top||rect.top>canvasRect.bottom||rect.right<canvasRect.left||rect.left>canvasRect.right)continue;
   const p=pool[panels.length];if(!p)break;
   p.x=rect.left+rect.width/2;p.y=rect.top+rect.height/2;p.halfWidth=rect.width/2;p.halfHeight=rect.height/2;p.radius=Math.min(28,p.halfWidth,p.halfHeight);p.clip=undefined;
   // Painéis dentro da área rolável são cortados por ela (somem sob o cabeçalho).
   const bounds=el.closest('.scroll')?.getBoundingClientRect();
   if(bounds)p.clip={x:bounds.left,y:bounds.top,width:bounds.width,height:bounds.height};
   panels.push(p);
  }
  renderer?.draw(reduced.matches?frozenTime:now,{pan,panels,glassLength:8*parseFloat(getComputedStyle(document.documentElement).fontSize)});
  dirty=false;lastDraw=now;
 }
 requestAnimationFrame(frame);
}
const resize=new ResizeObserver(invalidateScene);resize.observe(canvas);
const mutations=new MutationObserver(invalidateScene);mutations.observe(document.querySelector('#app')!,{childList:true,subtree:true,attributes:true,attributeFilter:['class','hidden']});
window.addEventListener('resize',invalidateScene);window.addEventListener('orientationchange',invalidateScene);window.addEventListener('pageshow',invalidateScene);visualViewport?.addEventListener('resize',invalidateScene);visualViewport?.addEventListener('scroll',invalidateScene);document.addEventListener('visibilitychange',invalidateScene);document.addEventListener('scroll',invalidateScene,true);
canvas.addEventListener('webglcontextlost',lost);canvas.addEventListener('webglcontextrestored',launch);reduced.addEventListener('change',motion);
launch();requestAnimationFrame(frame);
