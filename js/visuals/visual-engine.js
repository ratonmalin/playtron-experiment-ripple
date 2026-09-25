const PALETTES={
 major:["#70d6ff","#8affc1","#ffe66d","#ff9f8a","#c7a0ff","#8ee7ff"],
 minor:["#9b8cff","#6f8cff","#63d7d0","#8aa8ff","#d58cff","#74b7ff"],
 suspended:["#8ff0ff","#b5f7d0","#b9c4ff","#ffd39a","#9de7ff","#d0a8ff"]
};
const MODES={
 major:{speed:95,damping:.965,texture:.13},
 minor:{speed:78,damping:.96,texture:.17},
 suspended:{speed:68,damping:.975,texture:.11}
};
const TAU=Math.PI*2;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
function hexToRgb(hex){const n=parseInt(hex.slice(1),16);return {r:n>>16&255,g:n>>8&255,b:n&255}}
function rgba(c,a){return "rgba("+c.r+","+c.g+","+c.b+","+a+")"}

export class VisualEngine{
 constructor(eventBus){
  this.eventBus=eventBus;this.canvas=document.querySelector("#visual-field");this.ctx=this.canvas.getContext("2d");
  this.idle=document.querySelector("#idle-message");this.scaleId="major";this.ripples=[];this.last=performance.now();this.activeCount=0;this.lastActivity=performance.now();this.dpr=1;
  this.handleNoteOn=this.handleNoteOn.bind(this);this.handleNoteOff=this.handleNoteOff.bind(this);this.handleScale=this.handleScale.bind(this);this.frame=this.frame.bind(this);
  eventBus.on("noteon",this.handleNoteOn);eventBus.on("noteoff",this.handleNoteOff);eventBus.on("scalechange",this.handleScale);
 }
 start(){this.resize();addEventListener("resize",()=>this.resize());requestAnimationFrame(this.frame)}
 resize(){this.dpr=Math.min(devicePixelRatio||1,2);this.canvas.width=Math.floor(innerWidth*this.dpr);this.canvas.height=Math.floor(innerHeight*this.dpr);this.canvas.style.width=innerWidth+"px";this.canvas.style.height=innerHeight+"px";this.ctx.setTransform(this.dpr,0,0,this.dpr,0,0)}
 handleScale(e){this.scaleId=e.scale?.id||"major";this.lastActivity=performance.now();for(const r of this.ripples)r.color=hexToRgb(this.pickColor(r.note))}
 pickColor(note){const p=PALETTES[this.scaleId]||PALETTES.major;return p[Math.abs(Math.round(note))%p.length]}
 handleNoteOn(e){
  this.lastActivity=performance.now();this.activeCount++;
  const w=innerWidth,h=innerHeight;const index=Math.abs(Math.round(e.note))%16;const angle=index*2.39996323;
  const radius=Math.min(w,h)*(.18+.025*(index%5));const cx=w*.5+Math.cos(angle)*radius;const cy=h*.5+Math.sin(angle)*radius*.72;
  const color=hexToRgb(this.pickColor(e.note));const mode=MODES[this.scaleId]||MODES.major;
  this.ripples.push({note:e.note,x:cx,y:cy,r:0,amp:.55+.4*(e.velocity??1),speed:mode.speed*(.82+.35*(e.velocity??1)),width:14+Math.abs(e.note)%5*4,life:0,held:true,color,phase:Math.random()*TAU});
  if(this.ripples.length>28)this.ripples.splice(0,this.ripples.length-28)
 }
 handleNoteOff(e){this.lastActivity=performance.now();this.activeCount=Math.max(0,this.activeCount-1);for(let i=this.ripples.length-1;i>=0;i--){const r=this.ripples[i];if(r.note===e.note&&r.held){r.held=false;r.amp*=.72;break}}}
 frame(now){
  const dt=Math.min((now-this.last)/1000,.05);this.last=now;const w=innerWidth,h=innerHeight;const mode=MODES[this.scaleId]||MODES.major;
  this.ctx.fillStyle="rgba(2,2,4,"+(mode.damping<.97?.09:.075)+")";this.ctx.fillRect(0,0,w,h);
  this.drawMaterial(now,w,h,mode);
  for(const r of this.ripples){r.life+=dt;r.r+=r.speed*dt;if(!r.held)r.amp*=Math.pow(.32,dt);else r.amp=Math.min(1,r.amp+dt*.18)}
  this.drawInterference(w,h);
  for(let i=this.ripples.length-1;i>=0;i--){const r=this.ripples[i];if(r.amp<.008||r.r>Math.hypot(w,h)*1.05)this.ripples.splice(i,1)}
  this.idle.classList.toggle("visible",this.ripples.length===0&&now-this.lastActivity>6500);
  requestAnimationFrame(this.frame)
 }
 drawMaterial(now,w,h,mode){
  const c=this.ctx;const t=now*.00012;c.save();c.globalCompositeOperation="screen";
  c.globalAlpha=mode.texture;
  for(let i=0;i<7;i++){const y=h*(i+.5)/7+Math.sin(t*7+i)*18;c.beginPath();for(let x=-20;x<=w+20;x+=18){const yy=y+Math.sin(x*.006+t*13+i)*8;c.lineTo(x,yy)}c.strokeStyle="rgba(130,180,210,.08)";c.lineWidth=1;c.stroke()}
  c.restore()
 }
 drawInterference(w,h){
  const c=this.ctx;c.save();c.globalCompositeOperation="screen";
  for(let i=0;i<this.ripples.length;i++){
   const a=this.ripples[i];this.drawRipple(a);
   for(let j=i+1;j<this.ripples.length;j++){
    const b=this.ripples[j];const dx=a.x-b.x,dy=a.y-b.y;const d=Math.hypot(dx,dy);
    if(d>Math.min(w,h)*.9)continue;
    const overlap=Math.max(0,1-Math.abs(a.r-b.r)/90);if(overlap<=0)continue;
    const x=(a.x+b.x)/2,y=(a.y+b.y)/2;const strength=overlap*a.amp*b.amp*.13;
    const g=c.createRadialGradient(x,y,0,x,y,80);g.addColorStop(0,rgba(a.color,strength));g.addColorStop(1,rgba(a.color,0));c.fillStyle=g;c.beginPath();c.arc(x,y,80,0,TAU);c.fill()
   }
  }
  c.restore()
 }
 drawRipple(r){
  const c=this.ctx;const rings=4;for(let i=0;i<rings;i++){const rr=r.r-i*18; if(rr<2)continue;const fade=Math.exp(-r.life*.06)*(1-i/rings)*r.amp;const g=c.createRadialGradient(r.x,r.y,Math.max(0,rr-r.width),r.x,r.y,rr+r.width);g.addColorStop(0,rgba(r.color,0));g.addColorStop(.48,rgba(r.color,fade*.12));g.addColorStop(.5,rgba(r.color,fade*.7));g.addColorStop(.56,rgba(r.color,fade*.08));g.addColorStop(1,rgba(r.color,0));c.fillStyle=g;c.beginPath();c.arc(r.x,r.y,rr+r.width,0,TAU);c.arc(r.x,r.y,Math.max(0,rr-r.width),0,TAU,true);c.fill()}
  const halo=c.createRadialGradient(r.x,r.y,0,r.x,r.y,42);halo.addColorStop(0,rgba(r.color,r.amp*.32));halo.addColorStop(1,rgba(r.color,0));c.fillStyle=halo;c.beginPath();c.arc(r.x,r.y,42,0,TAU);c.fill()
 }
}