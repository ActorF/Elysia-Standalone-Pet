/** Merge local and global cursor samples without replaying stale IPC motion. */
import {setGazeTarget} from './state.mjs';
import {characterView} from './viewport.mjs';

export function createPointerTracking(state,anchor,clock=Date.now){
  let latestAt=-Infinity;
  return {
    sample({localX,localY,width,height,sampledAt,viewport}){
      if(![localX,localY,width,height].every(Number.isFinite)||width<=0||height<=0)return false;
      const at=Number.isFinite(sampledAt)?sampledAt:clock();
      if(!Number.isFinite(at)||at<latestAt)return false;
      // Large pets extend beyond the native window; use their virtual origin.
      const {scale,x:ox,y:oy}=characterView(width,height,viewport);
      setGazeTarget(state,(localX-ox-anchor.gazeX*scale)/(230*scale),(localY-oy-anchor.gazeY*scale)/(240*scale));
      latestAt=at;
      return true;
    },
  };
}
