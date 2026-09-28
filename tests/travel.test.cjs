'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../travel.js');
const E = require('../script.js');
const liveConfig = require('../maps-config.js');
const location = (town, id, lat) => T.confirmLocation(T.cleanLocation({ provider: 'google', formattedAddress: `123 Main Street, ${town}, AB, Canada`, municipality: town, unit: '2', placeId: id, lat, lng: -113.81 }));
const settings = { browserKey: 'test-only', shop: { formattedAddress: 'Synthetic shop, Test Town', municipality: 'Test Town', unit: '806', lat: 52.30, lng: -113.84, confirmed: true, confirmedBy: 'Test owner', confirmedAt: new Date().toISOString() } };
function fixture(type = 'transport') {
  const fromLocation = location('Red Deer', 'red-deer-place', 52.27), toLocation = location('Blackfalds', 'blackfalds-place', 52.38);
  const state = { moveType: type, fromAddress: fromLocation.formattedAddress, toAddress: toLocation.formattedAddress, fromLocation, toLocation, moveDate: '2099-01-01', moveTime: 'Morning' };
  state.travel = T.routeResult(T.routeSpec(state, settings), { legs: (type === 'transport' ? [600, 1200, 900] : [600, 900]).map(durationSeconds => ({ durationMillis: durationSeconds * 1000, distanceMeters: durationSeconds * 10 })) });
  return state;
}
test('production config fails closed until the owner confirms the shop and Google is configured', () => {
  const unconfigured = {browserKey:'',shop:{...liveConfig.shop,confirmed:false}};
  assert.equal(T.shopLocation(unconfigured), null);
  assert.equal(T.routeSpec(fixture(), unconfigured), null);
  assert.equal(liveConfig.shop.ownerProvidedAddress, '6834 59th ave, 806 Mustang Acres');
});
test('same street address in different towns has separate confirmed pins and route identity', () => {
  const s = fixture(); assert.notEqual(T.locationKey(s.fromLocation), T.locationKey(s.toLocation));
  assert.equal(E.computeMoveModel(s).sameAddress, false);
  const url = new URL(T.mapsLink(s.toLocation)); assert.equal(url.searchParams.get('query_place_id'), 'blackfalds-place');
  assert.equal(url.searchParams.get('query'), '52.38,-113.81');
});
test('ordered round trip has three legs and includes return to shop exactly once', () => {
  const s = fixture(), spec = T.routeSpec(s, settings), travel = T.currentTravel(s, settings);
  assert.deepEqual(spec.labels, ['Shop → pickup', 'Pickup → drop-off', 'Drop-off → shop']);
  assert.equal(spec.stops.length, 4); assert.equal(spec.stops[0], spec.stops[3]);
  assert.equal(travel.totalSeconds, 2700); assert.equal(travel.betweenAddressDriveHours, 1 / 3); assert.equal(travel.depotDriveHours, 1500 / 3600);
});
for (const type of ['same-property', 'load-only', 'unload-only']) test(`${type} includes depot travel and omits stale destination`, () => {
  const s = fixture(type), spec = T.routeSpec(s, settings), travel = T.currentTravel(s, settings);
  assert.equal(spec.stops.length, 3); assert.equal(travel.legs.length, 2); assert.equal(travel.betweenAddressDriveHours, 0);
  assert.equal(travel.totalSeconds, 1500); assert.doesNotMatch(T.planLines(s, settings).join('\n'), /Blackfalds/);
  assert.equal(E.buildEstimatePayload(s, 'test-token', true).locations.toAddress, undefined);
});
for (const field of ['formattedAddress', 'municipality', 'unit', 'placeId', 'lat', 'lng']) test(`editing ${field} invalidates confirmation and cached travel`, () => {
  const s = fixture(); s.fromLocation[field] = typeof s.fromLocation[field] === 'number' ? s.fromLocation[field] + 0.01 : 'changed';
  assert.equal(T.isConfirmed(s, 'fromAddress'), false); assert.equal(T.currentTravel(s, settings), null);
});
test('editing only the visible address cannot retain a confirmed old pin', () => {
  const s = fixture(); s.fromAddress = 'A different address'; assert.equal(T.isConfirmed(s, 'fromAddress'), false); assert.equal(T.currentTravel(s, settings), null);
});
test('input invalidation immediately removes route and confirmation', () => {
  const s = fixture(); T.invalidate(s, 'toAddress'); assert.equal(s.travel, undefined); assert.equal(T.isConfirmed(s, 'toAddress'), false);
});
for (const key of ['moveType', 'moveDate', 'moveTime']) test(`changing ${key} makes a previous response unusable`, () => {
  const s = fixture(); s[key] = {moveType:'same-property',moveDate:'2099-01-02',moveTime:'Afternoon'}[key]; assert.equal(T.currentTravel(s, settings), null);
});
test('a changed shop pin invalidates old travel', () => assert.equal(T.currentTravel(fixture(), {...settings, shop: {...settings.shop, lat:52.35}}), null));
test('shop confirmation needs a pin, municipality and recorded owner review', () => {
  for (const patch of [{lat:null},{lng:999},{confirmed:false},{confirmedAt:''},{confirmedBy:''},{municipality:''}]) assert.equal(T.routeSpec(fixture(), {...settings,shop:{...settings.shop,...patch}}),null);
});
for (const bad of [undefined, {}, {legs:[]}, {legs:[{durationMillis:600000,distanceMeters:1000}]}, {legs:[{}, {}, {}]}, {legs:Array(3).fill({durationMillis:null,distanceMeters:0})}, {legs:Array(3).fill({durationMillis:NaN,distanceMeters:10})}, {legs:Array(3).fill({durationMillis:0,distanceMeters:0})}, {legs:Array(3).fill({durationMillis:-1,distanceMeters:10})}]) test(`missing/invalid Maps result is unavailable, never zero: ${JSON.stringify(bad)}`, () => assert.throws(() => T.routeResult(T.routeSpec(fixture(), settings), bad), /unavailable/));
test('routes older than one hour or with missing legs fail closed', () => {
  const s=fixture(); assert.equal(T.currentTravel(s,settings,Date.parse(s.travel.calculatedAt)+T.MAX_AGE_MS+1),null);
  s.travel.legs=null; assert.equal(T.currentTravel(s,settings),null);
});
test('route totals are recomputed instead of trusting customer-editable totals', () => {
  const s=fixture(); s.travel.totalSeconds=1; s.travel.depotDriveHours=0; assert.equal(T.currentTravel(s,settings).totalSeconds,2700);
});
test('manual confirmation can submit details but does not fabricate a Google pin or driving time', () => {
  const s=fixture(); s.fromLocation=T.confirmLocation(T.cleanLocation({...s.fromLocation,provider:'manual'}));
  assert.equal(T.isConfirmed(s,'fromAddress'),true); assert.equal(T.currentTravel(s,settings),null);
  const lines=T.planLines(s,settings).join('\n'); assert.match(lines,/Pin|pin unverified/); assert.match(lines,/Travel estimate unavailable—staff review required/);
});
test('draft restoration preserves verified locations but discards routes and alleged staff approval', () => {
  const s=fixture(), draft=E.sanitizeDraft({...s,approvedBy:'customer',onSiteHours:3});
  assert.equal(T.isConfirmed(draft,'fromAddress'),true); assert.equal(draft.travel,undefined); assert.equal(draft.approvedBy,undefined);
  assert.equal(E.sanitizeDraft({...s,fromLocation:{...s.fromLocation,unit:'changed'}}).fromLocation.confirmed,false);
});
test('submitted notes and download include confirmations, units, Maps links and explicit unknown travel', () => {
  const s=fixture(); const p=E.buildEstimatePayload(s,'test-token',true);
  for (const value of ['Red Deer','Blackfalds','Unit / lot: 2','Customer confirmation: confirmed','https://www.google.com/maps/search/','Travel estimate unavailable—staff review required']) assert.ok(p.notes.includes(value),value);
  assert.equal(p.notes,p.cheatSheet); assert.equal(p.travel.totalSeconds,null); assert.equal(p.estimatedHours,null); assert.equal(p.estimatedBillableJobHours,null); assert.equal(p.estimatedCost,null);
});
test('reviewed on-site hours plus travel produce job hours, distinct from worker-hours and billing increments', () => {
  const s=fixture();
  const plan={approvedBy:'Synthetic staff review',evidenceRef:'test only',moveType:'transport',crewHours:3,crewSize:2,hourlyRate:100,rateBasis:'per-crew',minimumHours:0,billingIncrementMinutes:15,callOutFee:0,transportFee:0,taxRate:0};
  const r=E.priceReviewedMove(plan,s,settings);
  assert.equal(r.estimatedBillableJobHours,3.75); assert.equal(r.billedCrewHours,3.75); assert.equal(r.onSiteWorkerHours,6); assert.equal(r.totalCents,37500);
  assert.throws(()=>E.priceReviewedMove({...plan,approvedBy:''},s,settings));
  assert.throws(()=>E.priceReviewedMove({...plan,moveType:'same-property'},s,settings));
  T.invalidate(s,'fromAddress'); assert.throws(()=>E.priceReviewedMove(plan,s,settings),/unavailable/);
});
test('Google city-only selections are rejected; specific addresses keep municipality and exact pin', () => {
  const place={id:'test-place',formattedAddress:'123 Test Street, Red Deer, AB',location:{lat:()=>52.27,lng:()=>-113.81},addressComponents:[{longText:'Red Deer',types:['locality']}],types:['locality']};
  assert.throws(()=>T.fromGoogle(place),/specific/);
  place.addressComponents.push({longText:'123',types:['street_number']});
  const loc=T.fromGoogle(place,'806'); assert.equal(loc.municipality,'Red Deer'); assert.equal(loc.unit,'806'); assert.equal(loc.lat,52.27); assert.equal(loc.confirmed,false);
});
