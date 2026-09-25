const VERSION=new URL(import.meta.url).searchParams.get("v")||"unknown";
const keyboardModule=await import("./config/keyboard.js?v="+VERSION);
const eventBusModule=await import("./core/event-bus.js?v="+VERSION);
const keyboardInputModule=await import("./input/keyboard.js?v="+VERSION);
const touchInputModule=await import("./input/touch.js?v="+VERSION);
const audioModule=await import("./audio/audio.js?v="+VERSION);
const midiModule=await import("./input/midi.js?v="+VERSION);
const visualModule=await import("./visuals/visual-engine.js?v="+VERSION);
const {KEYBOARD_MAPPING,midiToNoteName}=keyboardModule;
const {ScaleManager}=await import("./config/scales.js?v="+VERSION);
const {EventBus}=eventBusModule;
const {KeyboardInput}=keyboardInputModule;
const {TouchInput}=touchInputModule;
const {AudioEngine}=audioModule;
const {MidiInput}=midiModule;
const {VisualEngine}=visualModule;

const eventBus=new EventBus();
const scaleManager=new ScaleManager();
const scaledInputBus={emit:event=>eventBus.emit(scaleManager.transform(event))};
const keyboardElement=document.querySelector("#keyboard");
const keyboard=new KeyboardInput(scaledInputBus);
const touch=new TouchInput(scaledInputBus,keyboardElement,KEYBOARD_MAPPING);
const audioEngine=new AudioEngine(eventBus);
const midiInput=new MidiInput(scaledInputBus);
const visualEngine=new VisualEngine(eventBus);

const scaleButton=document.querySelector("#scale-button");
const fullscreenButton=document.querySelector("#fullscreen-button");

function updateScale(){scaleButton.textContent="GAMME · "+scaleManager.label;eventBus.emit({type:"scalechange",index:scaleManager.index,scale:scaleManager.currentScale})}
scaleButton.addEventListener("click",async()=>{try{await audioEngine.start()}catch(e){};const {releases}=scaleManager.next();for(const e of releases)eventBus.emit(e);updateScale()});
fullscreenButton.addEventListener("click",async()=>{try{await audioEngine.start()}catch(e){};try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen()}catch(e){}});
document.addEventListener("fullscreenchange",()=>fullscreenButton.textContent=document.fullscreenElement?"EXIT FULL SCREEN":"FULL SCREEN");

function createKeyboardUI(){
 keyboardElement.innerHTML="";
 for(const [key,note] of Object.entries(KEYBOARD_MAPPING)){
  const el=document.createElement("div");el.className="key";el.dataset.key=key;
  el.innerHTML='<span class="key-note">'+midiToNoteName(scaleManager.mapKeyboardNote(note))+"</span>";
  keyboardElement.appendChild(el);
 }
}
const active=new Map();
function updateKey(event){
 if(event.source!=="keyboard"&&event.source!=="touch")return;
 const raw=Number.isFinite(event.rawNote)?event.rawNote:event.note;
 const key=Object.entries(KEYBOARD_MAPPING).find(([,n])=>n===raw)?.[0];if(!key)return;
 const el=keyboardElement.querySelector('[data-key="'+key+'"]');if(!el)return;
 if(event.type==="noteon"){active.set(event.note,(active.get(event.note)||0)+1);el.classList.add("active")}
 else{const n=Math.max(0,(active.get(event.note)||1)-1);if(n===0){active.delete(event.note);el.classList.remove("active")}else active.set(event.note,n)}
}
eventBus.on("noteon",updateKey);eventBus.on("noteoff",updateKey);
createKeyboardUI();updateScale();keyboard.start();touch.start();midiInput.start();visualEngine.start();
console.log("[RIPPLE] Ready",VERSION);
