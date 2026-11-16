const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const E = require('../script.js');
const read = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
const disallowed = /\bquot(?:e[ds]?|ing|ations?)\b/i;

for (const name of ['index.html', 'script.js', 'privacy.html', 'apps_script.gs', 'README.txt', 'docs/ESTIMATOR-AUDIT.md', 'travel.js', 'maps-config.js', 'docs/MAPS-SETUP.md', 'docs/ESTIMATE-EMAIL.md', 'email-worker/auto-reply.mjs']) {
  test(`MFTNB pricing terminology stays estimate-only: ${name}`, () => {
    assert.doesNotMatch(read(name), disallowed);
  });
}
test('retired public pages cannot collect or submit moving enquiries', () => {
  for (const name of ['index.html', 'blog/moving-checklist-before-moving-day/index.html', '404.html']) {
    const html = read(name);
    assert.doesNotMatch(html, /<(?:form|input|textarea|script|iframe)\b/i);
    assert.match(html, /Website retired/);
    assert.match(html, /mailto:info@mftnb\.ca/);
  }
});
test('retirement notice identifies a personal recommendation and the business contact', () => {
  const html = read('index.html');
  assert.match(html, /Susanna/);
  assert.match(html, /William Crowell, website creator/);
  assert.match(html, /This is the business inbox/);
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
test('retirement avoids cached forms and preserves historical draft storage', () => {
  const script = read('script.js');
  assert.match(read('_headers'), /^\/\*\n  Cache-Control: no-store/m);
  assert.ok(script.includes("const STORAGE_KEY = 'mftnb-estimate-v4'"));
});
