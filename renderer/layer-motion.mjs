/** Rigid rotations only: no mesh weights, scale, shear or changing limb width. */
export const LAYERS = Object.freeze([
  {id:'frontHair',pivot:[540,205],amplitude:.025,phase:0},
  {id:'backHair',pivot:[540,670],amplitude:.025,phase:-.16},
  {id:'legs',pivot:[505,1040],amplitude:.038,phase:-.38},
  {id:'skirt',pivot:[536,898],amplitude:.018,phase:-.24},
  {id:'tail',pivot:[768,1050],amplitude:.035,phase:-.5},
  {id:'face',pivot:[540,540],amplitude:0,phase:0},
  {id:'ears',pivot:[540,205],amplitude:0,phase:0},
]);

export function layerTransform(id,time=0,enabled=true) {
  const layer=LAYERS.find(item=>item.id===id);
  if(!layer)throw new RangeError(`Unknown layer: ${id}`);
  const t=Number.isFinite(time)?time:0;
  const angle=enabled?Math.sin(t*Math.PI*2/7.6+layer.phase)*layer.amplitude:0;
  const a=Math.cos(angle),b=Math.sin(angle),c=-b,d=a,[x,y]=layer.pivot;
  return {a,b,c,d,e:x-a*x-c*y,f:y-b*x-d*y};
}

export function transformLayerPoint(id,point,time=0,enabled=true) {
  const {a,b,c,d,e,f}=layerTransform(id,time,enabled),[x,y]=point;
  return [a*x+c*y+e,b*x+d*y+f];
}
