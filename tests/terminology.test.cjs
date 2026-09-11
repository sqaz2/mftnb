const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const E = require('../script.js');
const read = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
const disallowed = /\bquot(?:e[ds]?|ing|ations?)\b/i;

for (const name of ['index.html', 'script.js', 'privacy.html', 'apps_script.gs', 'README.txt', 'docs/ESTIMATOR-AUDIT.md']) {
  test(`MFTNB pricing terminology stays estimate-only: ${name}`, () => {
    assert.doesNotMatch(read(name), disallowed);
  });
}
test('homepage consistently requests a reviewed estimate without promising a booking', () => {
  const html = read('index.html');
  assert.ok(html.includes('Plan your move. Get a reviewed estimate.'));
  assert.ok(html.includes('Start your estimate request'));
  assert.ok(html.includes('This is an estimate request, not a confirmed price or booking.'));
  assert.ok(html.includes('Estimate after review'));
  assert.doesNotMatch(html, /\ba estimate\b/i);
});
test('downloaded plan and submission notes use estimate terminology', () => {
  const state = {moveType:'same-property', fromAddress:'123 Test Street, Red Deer', onSiteDetails:'Basement to garage'};
  const plan = E.generateCheatSheet(state);
  const payload = E.buildEstimatePayload(state, 'test-token', true);
  assert.ok(plan.startsWith('MOVE PLAN — ESTIMATE REQUEST, NOT A CONFIRMED BOOKING'));
  assert.equal(payload.source, 'website-estimate-request-v4');
  assert.equal(payload.formType, 'estimate');
  assert.equal(payload.notes, plan);
  assert.doesNotMatch(plan, disallowed);
  assert.equal(payload.estimatedCost, null);
  assert.equal(payload.estimatedHours, null);
  assert.equal(payload.crewSize, null);
});
test('new release invalidates script cache but keeps existing draft storage', () => {
  const html = read('index.html');
  const script = read('script.js');
  const version = script.match(/const ESTIMATOR_VERSION = '([^']+)'/)[1];
  assert.notEqual(version, '2026-09-11-review-first');
  assert.ok(html.includes(`script.js?v=${version}`));
  assert.ok(script.includes("const STORAGE_KEY = 'mftnb-estimate-v4'"));
});
