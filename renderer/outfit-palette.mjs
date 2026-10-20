/** Keeps the shared navy dress and stockings consistent across painted prop poses. */
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const smooth = (low, high, value) => {
  const t = clamp((value - low) / (high - low), 0, 1);
  return t * t * (3 - 2 * t);
};
const range = (value, low, fullLow, fullHigh, high) =>
  smooth(low, fullLow, value) * (1 - smooth(fullHigh, high, value));

// Soft colour membership avoids a visible threshold in a shaded fabric. The
// position bounds exclude facial features and props; colour excludes skin,
// pink hair/tail, white sleeves, gold buttons, blue plaid and dark ink contours.
function materialWeight(material, x, y, r, g, b) {
  if (material === 'stockings') {
    return range(x, 360, 385, 735, 760) * range(y, 1020, 1050, 1400, 1425)
      * range(r-g, 2, 9, 30, 42) * range(b-g, 2, 7, 28, 40)
      * (1-smooth(20, 30, Math.abs(r-b)))
      * range(g, 12, 28, 108, 135) * (1-smooth(125, 155, Math.max(r,g,b)));
  }
  return range(x, 300, 330, 755, 785) * range(y, 815, 845, 1090, 1120)
    * smooth(6, 18, b-r) * smooth(6, 18, b-g)
    * smooth(15, 35, g) * (1-smooth(125, 155, Math.max(r,g,b)));
}

const MATERIALS = [
  { name: 'stockings', sample: [420, 1090, 220, 200] },
  { name: 'dress', sample: [455, 890, 140, 100] },
];

function sampleMaterial(data, width, material) {
  const histogram = Array.from({ length: 3 }, () => new Uint32Array(256));
  const [x0, y0, sampleWidth, sampleHeight] = material.sample;
  let count = 0;
  for (let y=y0; y<y0+sampleHeight; y++) for (let x=x0; x<x0+sampleWidth; x++) {
    const offset = (y*width+x)*4;
    const [r,g,b,a] = data.subarray(offset, offset+4);
    if (a < 245 || materialWeight(material.name,x,y,r,g,b) < .98) continue;
    histogram[0][r]++; histogram[1][g]++; histogram[2][b]++; count++;
  }
  if (count < 100) return null;
  return histogram.map(channel => {
    let cumulative = 0;
    for (let value=0; value<256; value++) {
      cumulative += channel[value];
      if (cumulative > count/2) return value;
    }
    return 0;
  });
}

/**
 * Returns a calibrated canvas with unchanged geometry, alpha and prop details.
 * Call once after loading 1090 × 1443 pose/neutral canvases, never per frame.
 * Additive, bounded colour correction preserves each pose's fabric shading;
 * it never copies neutral pose pixels over a different arm, tail or prop.
 */
export function harmonizePoseOutfit(poseCanvas, neutralCanvas) {
  if (poseCanvas.width !== 1090 || poseCanvas.height !== 1443
    || neutralCanvas.width !== 1090 || neutralCanvas.height !== 1443) {
    throw new RangeError('Outfit calibration expects matching 1090 × 1443 character canvases');
  }
  const output=document.createElement('canvas');
  output.width=poseCanvas.width;output.height=poseCanvas.height;
  const context=output.getContext('2d',{willReadFrequently:true});
  context.drawImage(poseCanvas,0,0);
  const pose = context.getImageData(0,0,output.width,output.height);
  const neutral = neutralCanvas.getContext('2d').getImageData(0,0,output.width,output.height);
  const correction = context.createImageData(output.width,output.height);
  const adjustments = MATERIALS.map(material => {
    const from=sampleMaterial(pose.data,output.width,material);
    const to=sampleMaterial(neutral.data,output.width,material);
    return { name: material.name, delta: from && to ? to.map((v,i)=>clamp(v-from[i],-12,12)) : [0,0,0] };
  });
  for (let y=815; y<1425; y++) for (let x=300; x<785; x++) {
    const offset=(y*output.width+x)*4;
    const [r,g,b,a]=pose.data.subarray(offset,offset+4);
    const delta=[0,0,0];
    for (const adjustment of a ? adjustments : []) {
      const weight=materialWeight(adjustment.name,x,y,r,g,b);
      for(let channel=0;channel<3;channel++) delta[channel]+=adjustment.delta[channel]*weight;
    }
    if (!delta.some(value => Math.round(value) !== 0)) continue;
    for(let channel=0;channel<3;channel++) correction.data[offset+channel]=pose.data[offset+channel]+Math.round(delta[channel]);
    correction.data[offset+3]=255;
  }
  const patch=document.createElement('canvas');patch.width=output.width;patch.height=output.height;
  patch.getContext('2d').putImageData(correction,0,0);
  // Source-atop replaces RGB only where correction pixels exist and retains
  // the destination alpha, including partially transparent anti-aliased edges.
  // Untouched pixels avoid a get/put round trip through unpremultiplied ImageData.
  context.globalCompositeOperation='source-atop';context.drawImage(patch,0,0);
  context.globalCompositeOperation='source-over';
  return output;
}
