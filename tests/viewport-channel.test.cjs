'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createViewportChannel}=require('../electron/viewport-channel.cjs');
test('a blocked renderer receives only the latest virtual drag position after acknowledgement',()=>{
  const sent=[],channel=createViewportChannel(value=>sent.push(value));
  channel.publish({characterX:0});
  for(let x=1;x<=250;x++)channel.publish({characterX:x});
  assert.equal(sent.length,1);assert.deepEqual(channel.status,{pending:true,queued:true,published:1});
  channel.acknowledge(-1);assert.equal(sent.length,1);
  channel.acknowledge(sent[0].sequence);
  assert.equal(sent.length,2);assert.equal(sent[1].characterX,250);
  channel.acknowledge(sent[1].sequence);assert.deepEqual(channel.status,{pending:false,queued:false,published:2});
});
test('renderer restart discards stale queued geometry and accepts a fresh view',()=>{
  const sent=[],channel=createViewportChannel(value=>sent.push(value));
  channel.publish({characterX:0});channel.publish({characterX:20});channel.reset();
  channel.publish({characterX:30});assert.equal(sent.length,2);assert.equal(sent[1].characterX,30);
  channel.acknowledge(sent[0].sequence);assert.equal(channel.status.pending,true);
});
