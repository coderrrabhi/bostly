import { test } from 'node:test';
import assert from 'node:assert/strict';
import { enforcePlanningMinimum, planningMinimum } from '../src/lib/provider-run-minimum.ts';
import { planningProviderLimits } from '../src/lib/planningProviderLimits.ts';

test('minimum 100 never schedules 88, preserves count, exact total and start time', () => {
  const runs = [88,115,105,109,113].map((q,i)=>({quantity_to_send:q,scheduled_at:new Date(1795830000000+i*60000).toISOString()}));
  const out = enforcePlanningMinimum(runs,100);
  assert.equal(out.length,5);
  assert.equal(out[0]?.scheduled_at,runs[0]?.scheduled_at);
  assert.ok(out.every(r=>r.quantity_to_send>=100));
  assert.equal(out.reduce((sum,r)=>sum+r.quantity_to_send,0),530);
});
test('provider minimum 100 cannot be lowered by bundle minimum 1', () => {
  assert.equal(planningMinimum(1,100,1),100);
  assert.equal(planningMinimum(150,100,1),150);
});
test('too many runs regroup without changing total or window', () => {
  const runs=[88,88,88].map((q,i)=>({quantity_to_send:q,scheduled_at:String(i)}));
  const out=enforcePlanningMinimum(runs,100);
  assert.equal(out.length,2);
  assert.equal(out.reduce((sum,r)=>sum+r.quantity_to_send,0),264);
  assert.equal(out[0]?.scheduled_at,'0');assert.equal(out[1]?.scheduled_at,'2');
  assert.ok(out.every(r=>r.quantity_to_send>=100));
});
test('total below minimum is rejected instead of scheduling an impossible run',()=>{
  assert.throws(()=>enforcePlanningMinimum([{quantity_to_send:88}],100),/below provider minimum 100/);
});
test('missing imported service gets its actual minimum from provider catalogue',async()=>{
  const out=await planningProviderLimits([{user_provider_account_id:'a',provider_service_id:'7',min_quantity:null,max_quantity:null}],async()=>[{service:'7',min:100,max:10000000}]);
  assert.equal(out[0]?.min_quantity,100);
});
test('unavailable provider limits fail closed rather than defaulting to 1',async()=>{
  await assert.rejects(()=>planningProviderLimits([{user_provider_account_id:'a',provider_service_id:'7'}],async()=>[]),/could not be verified/);
});