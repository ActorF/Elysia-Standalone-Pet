/** Separate artwork planes with rigid, length-preserving rotations. */
import {layerTransform} from './layer-motion.mjs';
import {splitBodyLayers} from './body-layers.mjs';
import {splitBackLayers} from './back-layers.mjs';
import {splitHeadLayers} from './head-layers.mjs';
import {createEyeTracking} from './eye-tracking.mjs';
const W=1090,H=1443;
const make=()=>{const c=document.createElement('canvas');c.width=W;c.height=H;return c;};
export function createLayeredRig(images){
 const canvas=make(),ctx=canvas.getContext('2d'),eyeTracking=createEyeTracking(),cache=new Map();
 const tail=make();
 // The complete outlined root extends underneath the opaque right cloak.
 tail.getContext('2d').drawImage(images.tail,74,93,1415,827,720,990,368,220);
 function prepare(source,key,state){
  let layers=cache.get(key);if(layers?.source===source)return layers;
  const rear=splitBackLayers(source,images),body=splitBodyLayers(rear.body,source),head=splitHeadLayers(source,images,state);
  const bc=body.body.getContext('2d');bc.globalCompositeOperation='destination-out';bc.drawImage(head.headExclusionMask,0,0);bc.globalCompositeOperation='source-over';
  layers={...body,...head,backHair:rear.backHair,source};cache.set(key,layers);
  if(cache.size>4)cache.delete(cache.keys().next().value);return layers;
 }
 const drawLayer=(layer,id,time,enabled)=>{ctx.save();const {a,b,c,d,e,f}=layerTransform(id,time,enabled);ctx.transform(a,b,c,d,e,f);ctx.drawImage(layer,0,0);ctx.restore();};
 return {
  mode:'rigid-layers',get eyeTrackingAvailable(){return eyeTracking.available;},
  // Exposed for deterministic layer/geometry audits; runtime uses the same preparation.
  layers:prepare,
  draw(source,key,state,settings={},allowGaze=true){
   const layers=prepare(source,key,state),time=state.time??0,enabled=settings.hairMotion!==false;
   ctx.clearRect(0,0,W,H);
   drawLayer(layers.backHair,'backHair',time,enabled);
   if(state.cat)drawLayer(tail,'tail',time,enabled);
   ctx.drawImage(layers.underlay,0,0);
   drawLayer(layers.legs,'legs',time,enabled);
   drawLayer(layers.skirt,'skirt',time,enabled);
   ctx.drawImage(layers.body,0,0);
   ctx.drawImage(eyeTracking.draw(layers.face,state.gaze,allowGaze&&settings.eyeTracking!==false),0,0);
   if(state.glasses)ctx.drawImage(images.glassesFrame,0,0);
   drawLayer(layers.frontHair,'frontHair',time,enabled);
   ctx.drawImage(layers.ears,0,0);
   if(state.cat)ctx.drawImage(layers.catEars,0,0);
   ctx.drawImage(layers.foreground,0,0);
   return canvas;
  },
 };
}
