'use strict';

// A renderer can be busy resizing its backing surface. Retain only its newest
// camera geometry rather than queuing every 4 ms native drag sample.
function createViewportChannel(send){
  let pending=null,queued=null,sequence=0,published=0;
  function flush(){
    if(pending!==null||!queued)return;
    const payload=queued;queued=null;
    pending=++sequence;published++;send({...payload,sequence:pending});
  }
  return {
    publish(value){queued={...value};flush();},
    acknowledge(value){if(value===pending){pending=null;flush();}},
    reset(){pending=null;queued=null;},
    get status(){return {pending:pending!==null,queued:queued!==null,published};},
  };
}
module.exports={createViewportChannel};
