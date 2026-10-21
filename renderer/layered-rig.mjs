/** Separate artwork planes with rigid, length-preserving rotations. */
import {layerTransform} from './layer-motion.mjs';
import {splitBodyLayers} from './body-layers.mjs';
import {splitBackLayers} from './back-layers.mjs';
import {splitHeadLayers,createHeadStaticLayers} from './head-layers.mjs';
import {createEyeTracking} from './eye-tracking.mjs';
const W=1090,H=1443;
const make=()=>{const c=document.createElement('canvas');c.width=W;c.height=H;return c;};
export function createLayeredRig(images){
 const canvas=make(),ctx=canvas.getContext('2d'),eyeTracking=createEyeTracking(),cache=new Map(),poses=new Map();
 let hitHead=null;
 const tail=make();
 // The complete outlined root extends underneath the opaque right cloak.
 tail.getContext('2d').drawImage(images.tail,74,93,1415,827,720,990,368,220);
 function preparePose(pose='idle'){
  let shared=poses.get(pose);if(shared)return shared;
  const base=make();base.getContext('2d').drawImage(images[pose==='idle'?'neutral':pose],0,0,W,H);
  const rear=splitBackLayers(base,images),body=splitBodyLayers(rear.body,base),head=createHeadStaticLayers(images,base);
  const bc=body.body.getContext('2d');bc.globalCompositeOperation='destination-out';bc.drawImage(head.headExclusionMask,0,0);bc.globalCompositeOperation='source-over';
  shared={...body,backHair:rear.backHair,rearRemoval:rear.mask,head};poses.set(pose,shared);return shared;
 }
 function prepare(source,key,state){
  let layers=cache.get(key);if(layers?.source===source){cache.delete(key);cache.set(key,layers);return layers;}
  const shared=preparePose(state.pose),head=splitHeadLayers(source,images,state,shared.head);
  // Expression patches have a few antialiased pixels at the neck above y710.
  // Keep those exact current-source pixels while reusing all expensive lower
  // material segmentation. The original removal masks retain identical alpha.
  const body=make(),bc=body.getContext('2d');bc.drawImage(shared.body,0,0);
  bc.save();bc.beginPath();bc.rect(0,0,W,710);bc.clip();bc.globalCompositeOperation='copy';bc.drawImage(source,0,0,W,H);
  bc.globalCompositeOperation='destination-out';bc.drawImage(shared.rearRemoval,0,0);bc.drawImage(head.headExclusionMask,0,0);bc.restore();
  layers={body,legs:shared.legs,skirt:shared.skirt,underlay:shared.underlay,backHair:shared.backHair,...head,source};
  cache.set(key,layers);
  if(cache.size>4)cache.delete(cache.keys().next().value);return layers;
 }
 const drawLayer=(layer,id,time,enabled)=>{ctx.save();const {a,b,c,d,e,f}=layerTransform(id,time,enabled);ctx.transform(a,b,c,d,e,f);ctx.drawImage(layer,0,0);ctx.restore();};
 function hitLayers(state={}){
  const pose=state.pose??'idle',shared=preparePose(pose);
  // A separate canonical head avoids changing the live expression/blink LRU.
  // Only the outer alpha matters; the expression features stay inside it.
  // Keep only one temporary pose: finished hit regions retain compact masks,
  // not another set of full-resolution canvases for every possible action.
  if(hitHead?.pose!==pose)hitHead={pose,layers:splitHeadLayers(images[pose==='idle'?'neutral':pose],images,{pose,cat:true},shared.head)};
  const head=hitHead.layers;
  return [
   {image:shared.backHair,id:'backHair'},
   ...(state.cat?[{image:tail,id:'tail'}]:[]),
   {image:shared.underlay},{image:shared.legs,id:'legs'},
   {image:shared.skirt,id:'skirt'},{image:shared.body},{image:head.face},
   {image:images.glassesFrame},{image:head.frontHair,id:'frontHair'},
   {image:head.ears},...(state.cat?[{image:head.catEars}]:[]),{image:head.foreground},
  ];
 }
 return {
  mode:'rigid-layers',get eyeTrackingAvailable(){return eyeTracking.available;},
  // Exposed for deterministic layer/geometry audits; runtime uses the same preparation.
  layers:prepare,preparePose,hitLayers,
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
