'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const E = require('../script.js');
const sample = { moveType: 'same-property', fromAddress: '123 Test Street, Red Deer, AB', toAddress: '123 Test Street, Red Deer, AB', boxCount: 100, smallItemCount: 20, twoPersonItems: 20, fragileItems: 5, carryDistance: 15, stairsFrom: 0.5, stairsTo: 0.5, elevatorAccess: 'Not needed / ground floor', priorityQuiz: 'Keep costs lean', season: 'Normal / not sure' };
const q = id => E.questionList.find(q => q.id === id);

test('reported case: 140 unique items, no invented crew, duration, price or fee', () => {
  const m = E.computeMoveModel(sample);
  assert.equal(m.totalUnits, 140); assert.equal(m.transportBetweenAddresses, false);
  ['crewSize','productiveHours','estimatedCost','travelFee','perMoverRate'].forEach(k => assert.equal(m[k], null));
  assert.equal(m.errors.length, 0); assert.match(m.travelNote, /confirmed separately/);
});
test('empty form never emits a two-hour minimum or a price', () => {
  const m = E.computeMoveModel(); assert.equal(m.totalUnits, null); assert.equal(m.estimatedCost, null); assert.equal(m.productiveHours, null); assert.equal(m.transportBetweenAddresses, null);
});
for (const value of [undefined, null, '', ' ', NaN, Infinity, -1, 'unknown', false, true, [], {}, 'not a number']) {
  test(`unknown or invalid number remains null: ${String(value)}`, () => assert.equal(E.numericField(value), null));
}
for (const value of [0, '0', 0.5, '0.5', 10, '10']) {
  test(`valid quantity preserves zero and decimals: ${value}`, () => assert.equal(E.numericField(value), Number(value)));
}
for (const value of [-1, Infinity, '1.2', '', '10001', {}, false]) {
  test(`count validation rejects ${JSON.stringify(value)}`, () => assert.notEqual(E.validateAnswer(q('boxCount'), value), ''));
}
for (const value of [0, '0', 10000, 'unknown']) {
  test(`count validation accepts ${value}`, () => assert.equal(E.validateAnswer(q('boxCount'), value), ''));
}
test('stairs accept half flights, reject quarter flights and negatives', () => {
  assert.equal(E.validateAnswer(q('stairsFrom'), 0.5), '');
  assert.notEqual(E.validateAnswer(q('stairsFrom'), 0.25), '');
  assert.notEqual(E.validateAnswer(q('stairsFrom'), -1), '');
});
test('fragility cannot exceed total inventory', () => {
  assert.notEqual(E.validateAnswer(q('fragileItems'), 141, sample), '');
  assert.ok(E.computeMoveModel({...sample, fragileItems:141}).errors.length);
});
test('unknown inventory is not silently zero', () => assert.equal(E.computeMoveModel({...sample, boxCount:'unknown'}).totalUnits, null));
test('adding fragile care does not add physical items', () => assert.equal(E.computeMoveModel({...sample, fragileItems:20}).totalUnits, 140));
test('no special fee for no elevator or for budget preferences', () => {
  for (const elevatorAccess of ['None', 'Not needed / ground floor', 'Booked elevator']) for (const priorityQuiz of ['Keep costs lean', 'Finish as quickly as practical']) {
    const m = E.computeMoveModel({...sample, elevatorAccess, priorityQuiz}); assert.equal(m.estimatedCost, null); assert.equal(m.productiveHours, null);
  }
});
test('address comparison handles only safe formatting differences', () => {
  assert.equal(E.addressesMatch('123 Test Street, Red Deer, AB.', '123 TEST STREET Red Deer AB'), true);
  assert.equal(E.addressesMatch('Red Deer','Red Deer'), false);
  assert.equal(E.addressesMatch('',''), false);
  assert.equal(E.addressesMatch('Unit 1 123 Test Street','Unit 2 123 Test Street'), false);
});
test('identical addresses on transport flow require correction', () => {
  assert.equal(E.computeMoveModel({...sample, moveType:'transport'}).status, 'needs-correction');
  assert.notEqual(E.validateAnswer(q('toAddress'), sample.toAddress, {...sample, moveType:'transport'}), '');
});
for (const type of ['same-property','load-only','unload-only']) test(`${type} does not require a second address or duplicate stairs`, () => {
  const ids = E.visibleQuestions({moveType:type}).map(q => q.id);
  assert.equal(ids.includes('toAddress'), false); assert.equal(ids.includes('stairsTo'), false);
  assert.equal(E.computeMoveModel({moveType:type}).transportBetweenAddresses, false);
});
test('transport asks for destination and its access', () => {
  const ids = E.visibleQuestions({moveType:'transport'}).map(q=>q.id); assert.ok(ids.includes('toAddress')); assert.ok(ids.includes('stairsTo')); assert.equal(ids.includes('onSiteDetails'), false);
});
test('payload preserves zero and includes all details in existing backend notes', () => {
  const state = {...sample, boxCount:0, stairsFrom:0, fragileItems:0, specialItems:'Test piano', extraServices:['Furniture assembly / disassembly'], notes:'Test instruction', parkingDistance:'Loading bay', overheadRisks:'Not part of this version'};
  const p = E.buildEstimatePayload(state, 'fake-token', true);
  assert.equal(p.boxCount, 0); assert.equal(p.stairsFrom, 0); assert.equal(p.dropoff, sample.fromAddress);
  ['Test piano','Test instruction','Loading bay','Furniture assembly / disassembly','QUOTE REQUEST'].forEach(v => assert.ok(p.notes.includes(v)));
  assert.equal(p.notes, p.cheatSheet); assert.equal(p.estimatedCost, null); assert.equal(p.estimatedHours, null); assert.equal(p.consent,true);
});
test('hidden stale destination is not sent for on-site work', () => {
  const p=E.buildEstimatePayload({...sample,toAddress:'Do not send this unrelated old address'}, 't', false);
  assert.equal(p.dropoff,sample.fromAddress); assert.equal(p.notes.includes('unrelated old address'), false); assert.equal(p.consent,false);
});
test('specialty items and extras explicitly require review', () => {
  const m=E.computeMoveModel({...sample,specialItems:'piano',extraServices:['Packing']});
  assert.ok(m.reviewReasons.some(r=>r.includes('equipment'))); assert.ok(m.reviewReasons.some(r=>r.includes('separately')));
});
test('draft restore rejects arrays, extra keys and invalid field values', () => {
  assert.deepEqual(E.sanitizeDraft([]), {}); assert.deepEqual(E.sanitizeDraft(null), {});
  assert.deepEqual(E.sanitizeDraft({boxCount:-1, estimatedCost:100, name:'Test Name', '__proto__':'bad'}), {name:'Test Name'});
});
test('selects and multiselects reject invalid injected options', () => {
  assert.notEqual(E.validateAnswer(q('moveType'),'something else'),'');
  assert.notEqual(E.validateAnswer(q('extraServices'),['bad option']),'');
  assert.notEqual(E.validateAnswer(q('extraServices'),['Storage solutions','Storage solutions']),'');
});
test('dates reject past or impossible dates and accept today', () => {
  assert.notEqual(E.validateAnswer(q('moveDate'),'2000-01-01'),'');
  assert.notEqual(E.validateAnswer(q('moveDate'),'2099-02-31'),'');
  assert.equal(E.validateAnswer(q('moveDate'),E.localToday()),'');
});
for (const body of ['','<html>login</html>','{}','[]','null','not-json']) test(`response parsing does not produce affirmative acknowledgement: ${body}`, async () => {
  const d=await E.safeParseJson({text:async()=>body}); assert.notEqual(d?.ok,true);
});
test('explicit acknowledgement parses correctly', async()=>assert.deepEqual(await E.safeParseJson({text:async()=>' {"ok":true} '}),{ok:true}));

// Synthetic numbers for arithmetic tests, NOT MFTNB prices or calibration data.
const reviewed = {approvedBy:'Test reviewer',evidenceRef:'synthetic-test-fixture',moveType:'same-property',crewSize:2,crewHours:3,hourlyRate:100,rateBasis:'per-crew',minimumHours:0,billingIncrementMinutes:15,betweenAddressDriveHours:0,depotDriveHours:0,callOutFee:0,transportFee:0,taxRate:0};
test('per-crew rate is not multiplied by crew count', ()=>assert.equal(E.priceReviewedPlan(reviewed).totalCents,30000));
test('per-mover rate is multiplied by crew size exactly once',()=>assert.equal(E.priceReviewedPlan({...reviewed,rateBasis:'per-mover'}).totalCents,60000));
test('crew-clock time and worker-hours are distinct',()=>{
  const r=E.priceReviewedPlan(reviewed); assert.equal(r.billedCrewHours,3); assert.equal(r.onSiteWorkerHours,6);
});
test('approved call-out is separate from same-property transport',()=>{
  const r=E.priceReviewedPlan({...reviewed,callOutFee:25,depotDriveHours:0.5}); assert.equal(r.transportCents,0); assert.equal(r.callOutCents,2500); assert.equal(r.totalCents,37500);
});
test('inter-address driving and truck charge cannot sneak into on-site work',()=>{
  assert.throws(()=>E.priceReviewedPlan({...reviewed,betweenAddressDriveHours:1}));
  assert.throws(()=>E.priceReviewedPlan({...reviewed,transportFee:1}));
});
test('approved transport, minimum, increments, fees and tax itemize in cents',()=>{
  const r=E.priceReviewedPlan({...reviewed,moveType:'transport',crewHours:1.1,minimumHours:2,betweenAddressDriveHours:0.5,callOutFee:10,transportFee:20,taxRate:0.05});
  assert.equal(r.billedCrewHours,2); assert.equal(r.subtotalCents,23000); assert.equal(r.taxCents,1150); assert.equal(r.totalCents,24150);
});
test('rounding does not add an increment to an exact boundary',()=>assert.equal(E.priceReviewedPlan({...reviewed,crewHours:2.25}).billedCrewHours,2.25));
test('rounding charges only the configured increment',()=>assert.equal(E.priceReviewedPlan({...reviewed,crewHours:2.26}).billedCrewHours,2.5));
for (const change of [{approvedBy:''},{evidenceRef:''},{rateBasis:'unknown'},{crewSize:0},{crewSize:2.5},{crewHours:0},{hourlyRate:-1},{taxRate:2},{callOutFee:undefined},{billingIncrementMinutes:0},{hourlyRate:1e99}]) test(`reviewed pricing fails closed: ${JSON.stringify(change)}`,()=>assert.throws(()=>E.priceReviewedPlan({...reviewed,...change})));
test('static homepage makes no instant numeric promise and includes no-JS fallback',()=>{
  const html=fs.readFileSync(require('node:path').join(__dirname,'../index.html'),'utf8');
  assert.ok(html.includes('Quote after review')); assert.ok(html.includes('<noscript>')); assert.ok(!html.includes('Projected cost')); assert.ok(!html.includes('Instant email confirmation'));
});
