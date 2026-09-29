const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const crypto = require('node:crypto');
const source = fs.readFileSync('apps_script.gs','utf8');
const ownerEmail = 'owner@example.test';
const legacyHeaders = ['submittedAt', 'name', 'email', 'phone', 'pickup', 'dropoff', 'moveDate', 'timeWindow', 'homeSize', 'access', 'inventory', 'extras', 'notes', 'source'];
class Sheet {
  constructor(){ this.rows=[]; this.failAppend=false; }
  appendRow(row){ if(this.failAppend)throw new Error('storage failure'); this.rows.push([...row]); }
  getLastRow(){return this.rows.length;}
  setFrozenRows(){}
  getRange(r,c,h=1,w=1){const s=this;return {
    getValues(){return Array.from({length:h},(_,i)=>Array.from({length:w},(_,j)=>s.rows[r-1+i]?.[c-1+j]??''));},
    setValues(values){values.forEach((row,i)=>row.forEach((value,j)=>{s.rows[r-1+i]??=[];s.rows[r-1+i][c-1+j]=value;}));},
    setValue(value){this.setValues([[value]]);}
  };}
}
function harness(){
  const properties=new Map([['TURNSTILE_SECRET','synthetic-long-server-secret-for-testing-only']]);
  const props={getProperty:k=>properties.get(k)??null,setProperty(k,v){properties.set(k,String(v));},deleteProperty:k=>properties.delete(k)};
  const sheets=new Map(), mails=[], pushes=[], triggers=[];
  const sourceSheet = new Sheet(); sourceSheet.appendRow(legacyHeaders); sheets.set('Sheet1', sourceSheet);
  let locked=false;
  const state={sendCodeStatus:200,pushStatus:201,mailFails:false,verification:{success:true,hostname:'mftnb.com',action:'owner_login'}};
  const ctx={console:{error(){},warn(){},log(){}},Uint8Array,Uint32Array,BigInt,DataView,ArrayBuffer,Date,
    PropertiesService:{getScriptProperties:()=>props},
    LockService:{getScriptLock:()=>({waitLock(){assert.equal(locked,false,'lock must not be nested');locked=true;},releaseLock(){locked=false;}})},
    SpreadsheetApp:{flush(){},getActiveSpreadsheet:()=>({getSheetByName:n=>sheets.get(n)||null,insertSheet:n=>{const s=new Sheet;sheets.set(n,s);return s;},getRangeByName:()=>null})},
    ScriptApp:{getProjectTriggers:()=>triggers,newTrigger:name=>({timeBased(){return this;},everyMinutes(){return this;},create(){triggers.push({getHandlerFunction:()=>name});}}),deleteTrigger:t=>triggers.splice(triggers.indexOf(t),1)},
    Utilities:{getUuid:()=>crypto.randomUUID(),newBlob:value=>({getBytes:()=>Array.from(Buffer.from(value))}),base64EncodeWebSafe:bytes=>Buffer.from(bytes).toString('base64url'),base64DecodeWebSafe:value=>Array.from(Buffer.from(value,'base64url')),computeDigest:(_,value)=>Array.from(crypto.createHash('sha256').update(value).digest()),computeHmacSha256Signature:(data,key)=>Array.from(crypto.createHmac('sha256',key).update(data).digest()),DigestAlgorithm:{SHA_256:'SHA256'},Charset:{UTF_8:'UTF8'}},
    MailApp:{sendEmail:mail=>{if(state.mailFails)throw new Error('mail unavailable');mails.push(mail);}},
    UrlFetchApp:{fetch:(url,options)=>{
      if(url.includes('siteverify'))return{getContentText:()=>JSON.stringify(state.verification),getResponseCode:()=>200};
      pushes.push({url,options});if(state.pushStatus===0)throw new Error('network');
      return{getResponseCode:()=>state.pushStatus,getContentText:()=>''};
    }},
    ContentService:{MimeType:{JSON:'json'},createTextOutput:value=>({value,setMimeType(){return this;}})}
  };
  vm.createContext(ctx);vm.runInContext(source,ctx);
  const request=body=>JSON.parse(ctx.doPost({postData:{contents:JSON.stringify(body)}}).value);
  const enable=()=>{props.setProperty('MFTNB_OWNER_EMAIL',ownerEmail);ctx.enableOwnerNotifications();};
  function login(){request({action:'owner.code',email:ownerEmail,turnstileToken:'synthetic'});const code=mails.at(-1).body.match(/\b\d{8}\b/)[0];const token=crypto.randomBytes(32).toString('base64url');assert.equal(request({action:'owner.verify',code,newToken:token}).ok,true);return token;}
  function addDevice(token, suffix='one'){
    const pair=crypto.generateKeyPairSync('ec',{namedCurve:'prime256v1'}),jwk=pair.privateKey.export({format:'jwk'});
    const publicKey=Buffer.concat([Buffer.from([4]),Buffer.from(jwk.x,'base64url'),Buffer.from(jwk.y,'base64url')]).toString('base64url');
    assert.equal(request({action:'owner.keys',token,privateKey:jwk.d,publicKey}).ok,true);
    assert.equal(request({action:'owner.subscribe',token,subscription:{endpoint:'https://fcm.googleapis.com/fcm/send/'+suffix}}).ok,true);
  }
  function lead(kind='estimate'){
    const values=[new Date(), 'Synthetic customer', 'customer@example.test', '5555550100', 'Example pickup', 'Example destination', '2026-10-20', '', '', '', '', '', 'Safe move notes', '', '', 'Yes'];
    const sheet=ctx.getOrCreateSheet(kind==='estimate'?'Sheet1':'Quick Messages');const row=ctx.appendLeadRow_(sheet,values);ctx.recordOwnerLeadSafely_(kind,row,values);return row;
  }
  return{ctx,properties,props,sheets,mails,pushes,triggers,state,request,enable,login,addDevice,lead};
}
test('owner API remains unavailable until explicit private owner setup',()=>{const h=harness();assert.equal(h.request({action:'owner.inbox'}).setupRequired,true);assert.throws(()=>h.ctx.enableOwnerNotifications(),/verified owner email/);assert.equal(h.mails.length,0);});
test('owner setup adds one retry trigger and never sends email',()=>{const h=harness();h.enable();h.enable();assert.equal(h.triggers.length,1);assert.equal(h.mails.length,0);assert.equal(h.sheets.get('Owner Inbox').rows.length,1);});
test('anonymous callers cannot read leads, change statuses, set keys or subscribe',()=>{const h=harness();h.enable();for(const action of ['inbox','keys','subscribe','status','test','logout'])assert.equal(h.request({action:'owner.'+action}).error,'Please sign in again.');});
test('only the private owner address gets a code; wrong host/action checks fail closed',()=>{const h=harness();h.enable();h.request({action:'owner.code',email:'customer@example.test',turnstileToken:'test'});assert.equal(h.mails.length,0);h.state.verification.action='estimate';assert.equal(h.request({action:'owner.code',email:ownerEmail,turnstileToken:'test'}).ok,false);h.state.verification.action='owner_login';h.state.verification.hostname='attacker.example';assert.equal(h.request({action:'owner.code',email:ownerEmail,turnstileToken:'test'}).ok,false);assert.equal(h.mails.length,0);});
test('a code is single use, sessions store hashes and email changes revoke access',()=>{const h=harness();h.enable();const token=h.login();const saved=h.properties.get('MFTNB_OWNER_SESSIONS');assert.equal(saved.includes(token),false);assert.equal(h.request({action:'owner.inbox',token}).ok,true);assert.equal(h.request({action:'owner.verify',code:h.mails.at(-1).body.match(/\b\d{8}\b/)[0],newToken:token}).ok,false);h.props.setProperty('MFTNB_OWNER_EMAIL','replacement@example.test');assert.equal(h.request({action:'owner.inbox',token}).ok,false);});
test('guessing is capped at five attempts and code resends are limited',()=>{const h=harness();h.enable();assert.equal(h.request({action:'owner.code',email:ownerEmail,turnstileToken:'test'}).ok,true);assert.equal(h.request({action:'owner.code',email:ownerEmail,turnstileToken:'test'}).ok,false);for(let i=0;i<5;i++)assert.equal(h.request({action:'owner.verify',code:'bad'}).ok,false);assert.match(h.request({action:'owner.verify',code:'bad'}).error,/Too many/);});
test('expired codes and sessions are rejected',()=>{const h=harness();h.enable();const token=h.login();let sessions=JSON.parse(h.properties.get('MFTNB_OWNER_SESSIONS'));sessions[0].expires=Date.now()-1;h.props.setProperty('MFTNB_OWNER_SESSIONS',JSON.stringify(sessions));assert.equal(h.request({action:'owner.inbox',token}).ok,false);h.props.setProperty('MFTNB_OWNER_CHALLENGE',JSON.stringify({expires:Date.now()-1,email:ownerEmail}));assert.match(h.request({action:'owner.verify',code:'00000000'}).error,/expired/);});
test('push accepts trusted service URLs only and never follows redirects',()=>{const h=harness();h.enable();const token=h.login();for(const endpoint of ['http://fcm.googleapis.com/x','https://fcm.googleapis.com.evil.test/x','https://fcm.googleapis.com@evil.test/x','https://127.0.0.1/x','https://fcm.googleapis.com:443/x'])assert.equal(h.request({action:'owner.subscribe',token,subscription:{endpoint}}).ok,false);h.addDevice(token);h.request({action:'owner.test',token});assert.equal(h.pushes[0].options.followRedirects,false);assert.equal(h.pushes[0].options.payload,'');});
test('VAPID signature verifies with independent Node crypto and private key is never returned',()=>{const h=harness();h.enable();const token=h.login();h.addDevice(token);const inbox=h.request({action:'owner.inbox',token});const privateKey=JSON.parse(h.properties.get('MFTNB_OWNER_VAPID')).privateKey;assert.equal(JSON.stringify(inbox).includes(privateKey),false);assert.equal(h.request({action:'owner.test',token}).ok,true);const authorization=h.pushes[0].options.headers.Authorization;const [,jwt,pub]=authorization.match(/^vapid t=(.+), k=(.+)$/);const parts=jwt.split('.');const raw=Buffer.from(pub,'base64url');const key=crypto.createPublicKey({key:{kty:'EC',crv:'P-256',x:raw.subarray(1,33).toString('base64url'),y:raw.subarray(33).toString('base64url')},format:'jwk'});assert.equal(crypto.verify('sha256',Buffer.from(parts.slice(0,2).join('.')),{key,dsaEncoding:'ieee-p1363'},Buffer.from(parts[2],'base64url')),true);const claims=JSON.parse(Buffer.from(parts[1],'base64url'));assert.equal(claims.aud,'https://fcm.googleapis.com');assert.equal(claims.sub,'https://mftnb.com');assert.ok(claims.exp*1000>Date.now());});
test('lead delivery is queued, reconciled once, and marked sent without repeating',()=>{const h=harness();h.enable();const token=h.login();h.addDevice(token);h.lead();assert.equal(h.pushes.length,0);h.ctx.processOwnerNotifications();assert.equal(h.pushes.length,1);assert.equal(h.sheets.get('Owner Inbox').rows.length,2);assert.equal(h.sheets.get('Owner Inbox').rows[1][5],'sent');h.ctx.processOwnerNotifications();assert.equal(h.pushes.length,1);assert.equal(h.request({action:'owner.inbox',token}).leads.length,1);});
test('missed enqueue is recovered from the saved source Sheet',()=>{const h=harness();h.enable();h.sheets.get('Owner Inbox').failAppend=true;h.lead();assert.equal(h.sheets.get('Sheet1').rows.length,2);h.sheets.get('Owner Inbox').failAppend=false;h.ctx.processOwnerNotifications();assert.equal(h.sheets.get('Owner Inbox').rows.length,2);assert.equal(h.sheets.get('Owner Inbox').rows[1][5],'no-device');});
test('source leads are still accepted if email and owner enqueue fail',()=>{const h=harness();h.enable();h.state.mailFails=true;h.sheets.get('Owner Inbox').failAppend=true;h.state.verification.action='estimate';const response=h.request({formType:'estimate',turnstileToken:'test',name:'Test',email:'test@example.test',phone:'5555555555',pickup:'A',dropoff:'B'});assert.equal(response.ok,true);assert.equal(h.sheets.get('Sheet1').rows.length,2);});
test('retry does not send immediately again and permanent endpoint expiry removes device',()=>{const h=harness();h.enable();const token=h.login();h.addDevice(token);h.lead();h.state.pushStatus=503;h.ctx.processOwnerNotifications();assert.equal(h.sheets.get('Owner Inbox').rows[1][5],'retry');h.ctx.processOwnerNotifications();assert.equal(h.pushes.length,1);h.sheets.get('Owner Inbox').rows[1][7]=0;h.state.pushStatus=410;h.ctx.processOwnerNotifications();assert.equal(h.sheets.get('Owner Inbox').rows[1][5],'no-device');assert.equal(JSON.parse(h.properties.get('MFTNB_OWNER_DEVICES')).length,0);});
test('permanent push failures surface as failed; no failure overwrites lead status',()=>{const h=harness();h.enable();const token=h.login();h.addDevice(token);h.lead();const id=h.request({action:'owner.inbox',token}).leads[0].id;assert.equal(h.request({action:'owner.status',token,id,status:'contacted'}).ok,true);h.state.pushStatus=403;h.ctx.processOwnerNotifications();assert.equal(h.sheets.get('Owner Inbox').rows[1][4],'contacted');assert.equal(h.sheets.get('Owner Inbox').rows[1][5],'failed');});
test('expired jobs do not send stale notifications and old source rows do not flood setup',()=>{const h=harness();h.lead();h.enable();const token=h.login();h.addDevice(token);h.ctx.processOwnerNotifications();assert.equal(h.pushes.length,0);h.lead();h.sheets.get('Owner Inbox').rows[1][1]=Date.now()-90000000;h.ctx.processOwnerNotifications();assert.equal(h.pushes.length,0);assert.equal(h.sheets.get('Owner Inbox').rows[1][5],'expired');});
test('logout revokes the session and its phone subscription',()=>{const h=harness();h.enable();const token=h.login();h.addDevice(token);assert.equal(h.request({action:'owner.logout',token}).ok,true);assert.equal(h.request({action:'owner.inbox',token}).ok,false);assert.equal(JSON.parse(h.properties.get('MFTNB_OWNER_DEVICES')).length,0);});
test('frontend endpoint matches existing form; worker cannot cache customer data',()=>{const frontend=fs.readFileSync('script.js','utf8'),config=fs.readFileSync('owner/config.js','utf8');assert.ok(config.includes(frontend.match(/const APPS_SCRIPT_URL = '([^']+)'/)[1]));const sw=fs.readFileSync('owner/sw.js','utf8');assert.equal(/caches\.|addEventListener\(['"]fetch/.test(sw),false);const manifest=JSON.parse(fs.readFileSync('owner/manifest.webmanifest'));assert.equal(manifest.scope,'/owner/');assert.equal(manifest.start_url,'/owner/');});
test('quick messages enter the same private inbox and remain distinct from estimates',()=>{const h=harness();h.enable();const token=h.login();h.state.verification.action='quick_message';assert.equal(h.request({formType:'quick-message',turnstileToken:'test',name:'Example contact',message:'Please call about a sofa',phone:'5555550100'}).ok,true);const list=h.request({action:'owner.inbox',token}).leads;assert.equal(list.length,1);assert.equal(list[0].kind,'message');assert.equal(list[0].details.message,'Please call about a sofa');});
test('service worker displays a visible generic alert and opens only the owner inbox',async()=>{const handlers={},shown=[],opened=[];const ctx={URL,Promise,self:{location:{origin:'https://mftnb.com'},addEventListener:(type,handler)=>handlers[type]=handler,registration:{showNotification:async(title,options)=>shown.push({title,options})},clients:{matchAll:async()=>[],openWindow:async url=>opened.push(url)}}};vm.runInNewContext(fs.readFileSync('owner/sw.js','utf8'),ctx);let pending;handlers.push({waitUntil:p=>pending=p,data:{name:'must not be displayed'}});await pending;assert.equal(shown[0].title,'New MFTNB lead');assert.equal(JSON.stringify(shown).includes('must not be displayed'),false);handlers.notificationclick({notification:{close(){}},waitUntil:p=>pending=p});await pending;assert.equal(opened[0],'/owner/');});


test('reconciliation reads historical 14-column Sheet1 leads without shifting their details', () => {
  const h = harness(); h.enable(); const token = h.login();
  const sheet = h.sheets.get('Sheet1');
  const row = [new Date(), 'Legacy customer', 'legacy@example.test', '5555550100',
    'Pickup town', 'Destination town', '2026-10-20', 'Morning', 'Apartment',
    'Third floor stairs', 'Upright piano', 'Packing', 'Confirmed move-plan notes', 'Website'];
  sheet.appendRow(row);
  h.ctx.processOwnerNotifications();
  const lead = h.request({ action: 'owner.inbox', token }).leads[0];
  assert.deepEqual(lead.details, {
    name: row[1], email: row[2], phone: row[3], pickup: row[4], dropoff: row[5],
    moveDate: row[6], timeWindow: row[7], homeType: row[8], bedrooms: '',
    access: row[9], inventory: row[10], extras: row[11], notes: row[12]
  });
  assert.deepEqual(sheet.rows, [legacyHeaders, row]);
  assert.equal(h.sheets.has('Leads'), false);
  h.ctx.processOwnerNotifications();
  assert.equal(h.request({ action: 'owner.inbox', token }).leads.length, 1);
});

test('new Sheet1 submissions and recovered owner records show the same details', () => {
  const h = harness(); h.enable(); const token = h.login();
  h.state.verification.action = 'estimate';
  const body = { formType: 'estimate', turnstileToken: 'test', name: 'New customer',
    email: 'new@example.test', phone: '5555550100', pickup: 'Pickup town', dropoff: 'Destination town',
    homeType: 'Townhouse', bedrooms: '2', access: 'Side door', inventory: 'Piano',
    extras: ['Packing'], notes: 'Confirmed route details', consent: true };
  assert.equal(h.request(body).ok, true);
  const first = h.request({ action: 'owner.inbox', token }).leads[0];
  assert.equal(first.details.bedrooms, '2');
  assert.equal(first.details.access, body.access);
  assert.equal(first.details.inventory, body.inventory);
  assert.equal(first.details.notes, body.notes);
  const sheet = h.sheets.get('Sheet1');
  assert.deepEqual(sheet.rows[0], [...legacyHeaders, 'bedrooms', 'consent']);
  assert.equal(sheet.rows[1][13], '');
  assert.equal(sheet.rows[1][14], '2');
  assert.equal(sheet.rows[1][15], 'Yes');
  h.sheets.get('Owner Inbox').rows.splice(1);
  h.ctx.processOwnerNotifications();
  const recovered = h.request({ action: 'owner.inbox', token }).leads[0];
  assert.deepEqual(recovered.details, first.details);
  assert.equal(recovered.id, first.id);
});
