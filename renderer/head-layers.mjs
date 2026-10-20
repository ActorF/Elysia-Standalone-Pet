/** Head artwork separated into rigid planes. No vertices, scale, or skin deformation. */
const W=1090,H=1443;
const canvas=()=>{const c=document.createElement('canvas');c.width=W;c.height=H;return c;};
const trace=(ctx,commands)=>{ctx.beginPath();for(const [op,...args]of commands)ctx[op](...args);};
const cut=(source,commands)=>{
  const result=canvas(),ctx=result.getContext('2d');
  ctx.save();trace(ctx,commands);ctx.clip();ctx.drawImage(source,0,0,W,H);ctx.restore();return result;
};
const poly=points=>[['moveTo',...points[0]],...points.slice(1).map(p=>['lineTo',...p]),['closePath']];

// Deliberately inside the old hair ink. The skin beneath is supplied separately,
// so moving the hair cannot expose a second copy of its stationary contour.
const FACE_SKIN=[
  ['moveTo',365,535],['lineTo',453,523],['lineTo',537,501],
  ['lineTo',596,501],['lineTo',680,501],['quadraticCurveTo',704,548,681,584],
  ['quadraticCurveTo',667,603,675,615],
  ['quadraticCurveTo',640,653,586,672],
  ['quadraticCurveTo',477,712,376,665],
  ['quadraticCurveTo',354,654,357,644],
  ['quadraticCurveTo',355,616,355,574],['closePath'],
];
// Individual eye silhouettes include the overhanging lash corners while
// avoiding the neighbouring pink framing locks. Their pixels remain original.
const LEFT_EYE=poly([[306,518],[339,495],[371,479],[403,478],[433,489],[458,513],[460,544],[456,588],[432,627],[390,635],[361,615],[350,583],[346,558],[329,551],[322,535]]);
const RIGHT_EYE=poly([[551,495],[572,470],[604,450],[638,433],[678,426],[682,439],[704,442],[710,450],[708,487],[704,529],[690,574],[662,596],[620,593],[584,567],[565,530]]);
const ELF_EAR=[['moveTo',917,425],['quadraticCurveTo',945,419,962,422],['quadraticCurveTo',976,424,970,437],['quadraticCurveTo',950,468,914,495],['lineTo',914,434],['closePath']];
const CAT_LEFT=[['moveTo',173,280],['quadraticCurveTo',188,276,186,251],['quadraticCurveTo',180,144,213,81],['lineTo',226,61],['quadraticCurveTo',260,84,337,105],['quadraticCurveTo',383,121,410,145],['quadraticCurveTo',376,140,347,167],['lineTo',365,173],['quadraticCurveTo',341,197,305,218],['quadraticCurveTo',274,235,248,280],['lineTo',225,331],['lineTo',220,298],['quadraticCurveTo',190,310,177,293],['closePath']];
const CAT_RIGHT=[['moveTo',674,130],['quadraticCurveTo',737,102,793,61],['lineTo',844,25],['quadraticCurveTo',859,19,862,43],['quadraticCurveTo',899,82,894,166],['lineTo',883,256],['quadraticCurveTo',880,273,881,295],['lineTo',865,270],['lineTo',854,315],['quadraticCurveTo',842,269,802,244],['quadraticCurveTo',781,219,746,215],['lineTo',768,196],['quadraticCurveTo',728,187,714,162],['lineTo',737,157],['closePath']];

/** The original head must be erased before the new separated planes are drawn. */
export function makeHeadExclusionMask(){
  const mask=canvas(),ctx=mask.getContext('2d');ctx.fillStyle='#fff';
  trace(ctx,[['moveTo',0,0],['lineTo',W,0],['lineTo',W,700],['lineTo',907,700],
    ['quadraticCurveTo',882,716,867,736],['quadraticCurveTo',809,767,762,738],
    ['quadraticCurveTo',731,714,704,692],['quadraticCurveTo',669,668,647,675],
    ['quadraticCurveTo',620,680,598,687],['lineTo',552,690],['lineTo',511,696],['lineTo',491,713],
    ['quadraticCurveTo',451,746,367,761],['quadraticCurveTo',271,793,188,775],
    ['lineTo',0,785],['closePath']]);ctx.fill();return mask;
}

/** Foreground contact props stay in front of both the face and moving hair. */
export function makeHeadForeground(source,pose='idle'){
  const foreground=canvas(),ctx=foreground.getContext('2d');
  let commands;
  if(pose==='megaphone')commands=[['moveTo',0,442],['lineTo',149,466],['lineTo',321,568],['lineTo',371,603],['quadraticCurveTo',403,609,407,667],['lineTo',430,822],['lineTo',0,822],['closePath']];
  if(pose==='tea')commands=poly([[507,607],[549,600],[582,633],[632,632],[693,715],[636,835],[523,807]]);
  if(pose==='cake')commands=[['moveTo',565,625],['quadraticCurveTo',594,613,613,637],['lineTo',624,651],['lineTo',706,691],['lineTo',707,743],['lineTo',549,706],['lineTo',542,656],['closePath']];
  if(commands)ctx.drawImage(cut(source,commands),0,0);
  if(pose==='cake'){
    ctx.drawImage(cut(source,[['moveTo',662,702],['quadraticCurveTo',674,685,700,687],['quadraticCurveTo',742,700,752,745],['quadraticCurveTo',758,785,740,823],['quadraticCurveTo',706,811,688,784],['lineTo',675,762],['quadraticCurveTo',664,748,671,734],['quadraticCurveTo',661,723,671,716],['closePath']]),0,0);
    // The complete strawberry, slice and plate are also in front of the bob.
    // A fork-only cutout hides the cake behind the new moving left curl.
    ctx.drawImage(cut(source,[['moveTo',286,779],['lineTo',323,767],['lineTo',323,739],['quadraticCurveTo',322,719,351,710],['lineTo',366,706],['quadraticCurveTo',375,681,390,683],['quadraticCurveTo',404,686,416,708],['quadraticCurveTo',447,703,456,732],['lineTo',458,770],['quadraticCurveTo',495,775,492,790],['quadraticCurveTo',491,808,448,809],['lineTo',328,810],['quadraticCurveTo',282,806,285,788],['closePath']]),0,0);
  }
  // The neck bow and brooch sit in front of the short bob's lower curls.
  // Their silhouettes must survive removal of the old painted head.
  ctx.drawImage(cut(source,poly([[511,695],[537,700],[564,693],[593,678],[605,687],[592,700],[610,711],[603,744],[566,753],[558,767],[533,775],[512,757],[479,766],[469,757],[477,733],[489,718],[510,714]])),0,0);
  if(pose==='idle'||pose==='megaphone'){
    // Open palm of the default pose, followed down to its white cuff. Drawing
    // it after the new hair keeps the hand visibly in front of the cheek curl.
    ctx.drawImage(cut(source,[['moveTo',716,785],['lineTo',747,757],['quadraticCurveTo',760,724,778,708],['quadraticCurveTo',791,700,797,713],['quadraticCurveTo',814,700,825,713],['quadraticCurveTo',840,732,820,754],['quadraticCurveTo',800,777,777,803],['lineTo',768,825],['lineTo',738,823],['closePath']]),0,0);
  }
  return foreground;
}

/** Cached per-expression cutouts; all returned canvases share original sprite coordinates. */
export function splitHeadLayers(source,images,state={}){
  const face=canvas(),fc=face.getContext('2d');
  // Only the inpainted forehead is used from the generated underlay; its
  // altered ear/body never replace the original anatomy or outfit.
  // The hidden cheeks need real overlap behind the complete moving locks.
  // Sample already painted interior skin without scaling it; the generated
  // bald-head alpha alone stops too early beside the left eye and reveals a
  // transparent crescent when the whole hair plane rotates to either peak.
  for(const [offset,commands]of [
    [-110,[['moveTo',299,497],['lineTo',371,490],['lineTo',395,607],['lineTo',381,654],['lineTo',350,653],['quadraticCurveTo',311,641,300,598],['quadraticCurveTo',291,548,299,497],['closePath']]],
    [75,[['moveTo',674,534],['lineTo',744,527],['lineTo',746,601],['quadraticCurveTo',714,628,681,647],['quadraticCurveTo',656,660,629,669],['lineTo',649,629],['closePath']]],
  ]){fc.save();trace(fc,commands);fc.clip();fc.drawImage(images.headUnderlay,offset,0,W,H);fc.restore();}
  const scalp=poly([[300,630],[296,430],[331,260],[473,183],[629,184],[740,267],[747,438],[737,562],[680,620],[575,684],[420,688]]);
  fc.drawImage(cut(images.headUnderlay,scalp),0,0);
  fc.drawImage(cut(source,FACE_SKIN),0,0);
  fc.drawImage(cut(source,LEFT_EYE),0,0);fc.drawImage(cut(source,RIGHT_EYE),0,0);
  // Preserve the full original jaw ink and neck attachment without importing
  // the pink curls immediately outside either cheek.
  fc.drawImage(cut(source,[['moveTo',358,638],['quadraticCurveTo',415,660,493,652],['quadraticCurveTo',585,651,681,617],['lineTo',696,624],['quadraticCurveTo',637,670,578,684],['quadraticCurveTo',472,714,375,670],['lineTo',351,652],['closePath']]),0,0);

  const frontHair=canvas(),hc=frontHair.getContext('2d');hc.drawImage(images.frontHair,0,0,W,H);
  // These two fine grey brows are printed across the fringe and move with it.
  // Their tight clips cannot bring the old dark hair outline along for the ride.
  for(const commands of [
    [['moveTo',349,439],['quadraticCurveTo',385,411,428,418],['lineTo',429,423],['quadraticCurveTo',389,416,351,445],['closePath']],
    [['moveTo',535,386],['quadraticCurveTo',583,372,644,385],['lineTo',644,391],['quadraticCurveTo',585,379,537,395],['closePath']],
  ]){
    const brow=cut(source,commands),bc=brow.getContext('2d'),pixels=bc.getImageData(340,365,310,85);
    // Grey translucent brow ink is lighter than the plum hair contour. Keeping
    // only that ink prevents a fragment of the previous fringe becoming a
    // second stationary line where a brow crosses a strand.
    for(let i=0;i<pixels.data.length;i+=4){
      const [r,g,b]=pixels.data.slice(i,i+3);
      if(r<95||r>225||g<70||g>175||b<95||b>215)pixels.data[i+3]=0;
    }
    bc.putImageData(pixels,340,365);hc.drawImage(brow,0,0);
  }

  const ears=cut(source,ELF_EAR),catEars=canvas();
  if(state.cat){const cc=catEars.getContext('2d');cc.drawImage(cut(images.cat??source,CAT_LEFT),0,0);cc.drawImage(cut(images.cat??source,CAT_RIGHT),0,0);}
  return {face,frontHair,ears,catEars,foreground:makeHeadForeground(source,state.pose),headExclusionMask:makeHeadExclusionMask()};
}
