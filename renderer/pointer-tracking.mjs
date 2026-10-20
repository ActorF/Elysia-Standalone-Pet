/** Merge local and global cursor samples without replaying stale IPC motion. */
import {setGazeTarget} from './state.mjs';

export function createPointerTracking(state,anchor,clock=Date.now){
  let latestAt=-Infinity;
  return {
    sample({localX,localY,width,height,sampledAt}){
      if(![localX,localY,width,height].every(Number.isFinite)||width<=0||height<=0)return false;
      const at=Number.isFinite(sampledAt)?sampledAt:clock();
      if(!Number.isFinite(at)||at<latestAt)return false;
      // Canvas uses object-fit: contain; compensate for any letterboxing.
      const scale=Math.min(width/600,height/800);
      const ox=(width-600*scale)/2,oy=(height-800*scale)/2;
      setGazeTarget(state,(localX-ox-anchor.gazeX*scale)/(230*scale),(localY-oy-anchor.gazeY*scale)/(240*scale));
      latestAt=at;
      return true;
    },
  };
}
