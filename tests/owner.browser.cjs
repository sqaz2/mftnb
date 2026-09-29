// Offline browser checks. All Google/Turnstile requests are mocked; no real lead or email is sent.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const {chromium}=require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES ? process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES+'/playwright' : 'playwright');
const root=path.resolve(__dirname,'..');
const mime={'.html':'text/html','.js':'application/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.webmanifest':'application/manifest+json'};
const server=http.createServer((req,res)=>{
  const pathname=new URL(req.url,'http://local').pathname;
  const file=path.join(root,pathname.endsWith('/')?pathname+'index.html':pathname);
  if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
  fs.readFile(file,(err,body)=>{if(err){res.writeHead(404).end();return;}res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'text/plain'});res.end(body);});
});
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const options={headless:true};
 if(process.env.MFTNB_CHROMIUM_MODULE){const {default:c}=await import(process.env.MFTNB_CHROMIUM_MODULE);options.args=c.args;options.executablePath=await c.executablePath();}
 const browser=await chromium.launch(options);
 const origin='http://127.0.0.1:'+server.address().port;
 const errors=[];
 async function page({signedIn=false,ios=false,setup=true,width=390}={}){
  const ctx=await browser.newContext({viewport:{width,height:844},...(ios?{userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1',isMobile:true,hasTouch:true}:{})});
  await ctx.addInitScript(({signedIn})=>{
   if(signedIn)localStorage.setItem('mftnb-owner-session-v1','A'.repeat(43));
   window.__noticePermission='default'; window.__pushSubscription=null;
   Object.defineProperty(window,'Notification',{value:{get permission(){return window.__noticePermission;},requestPermission(){window.__noticePermission='granted';return Promise.resolve('granted');}}});
   Object.defineProperty(window,'PushManager',{value:function(){}});
   const registration={pushManager:{getSubscription:async()=>window.__pushSubscription,subscribe:async options=>{window.__pushSubscription={options,unsubscribe:async()=>{window.__pushSubscription=null;return true;},toJSON:()=>({endpoint:'https://fcm.googleapis.com/fcm/send/synthetic'})};return window.__pushSubscription;}}};
   Object.defineProperty(navigator,'serviceWorker',{value:{register:async()=>registration,ready:Promise.resolve(registration),addEventListener(){}}});
  },{signedIn});
  const calls=[], data=[
   {id:'lead1',received:Date.now(),kind:'estimate',status:'new',details:{name:'Jamie Thompson',phone:'(555) 555-0100',email:'jamie@example.test',pickup:'123 Example Avenue, Red Deer',dropoff:'456 Sample Street, Blackfalds',moveDate:'October 12',notes:'<img src=x onerror="window.__xss=1">\nPlease call before arriving.'}},
   {id:'lead2',received:Date.now()-3600000,kind:'message',status:'new',details:{name:'Alex Morgan',phone:'5555550101',message:'Looking for help moving a sofa this weekend. Is Saturday available?'}},
   {id:'lead3',received:Date.now()-86400000,kind:'estimate',status:'contacted',details:{name:'Taylor Lee',pickup:'Red Deer',dropoff:'Lacombe'}}
  ];
  let enabled=false;
  await ctx.route('https://script.google.com/**',async route=>{
   const req=route.request();let result={ok:true,ownerApp:setup?1:undefined,enabled:setup};
   if(req.method()==='POST'){
    const body=req.postDataJSON();calls.push(body);
    if(body.action==='owner.inbox')result={ok:true,leads:data,publicKey:null,notificationsEnabled:enabled,lastDeliveryRun:Date.now()};
    if(body.action==='owner.keys')result={ok:true,publicKey:body.publicKey};
    if(body.action==='owner.subscribe')enabled=true;
    if(body.action==='owner.status')data.find(x=>x.id===body.id).status=body.status;
    if(body.action==='owner.code')result={ok:true,message:'If this is the owner email, a sign-in code is on its way.'};
   }
   await route.fulfill({contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*'},body:JSON.stringify(result)});
  });
  await ctx.route('https://challenges.cloudflare.com/**',route=>route.fulfill({contentType:'application/javascript',body:"window.turnstile={render(sel,o){window.__turnstileOptions=o;queueMicrotask(()=>o.callback('synthetic-turnstile'));return 0;},reset(){queueMicrotask(()=>window.__turnstileOptions.callback('synthetic-turnstile'));}};window.mftnbOwnerTurnstile();"}));
  const p=await ctx.newPage();p.on('pageerror',e=>errors.push(e.message));await p.goto(origin+'/owner/');
  await p.waitForFunction(()=>document.querySelector('#notice').textContent!=='Connecting to your inbox…');
  return{ctx,p,calls};
 }
 try{
  const login=await page();await login.p.locator('#login').waitFor({state:'visible'});await login.p.screenshot({path:'/tmp/mftnb-owner-login.png',fullPage:true});
  assert.equal(await login.p.locator('#dashboard').isVisible(),false);
  await login.p.locator('#email').fill('owner@example.test');await login.p.locator('#sendCode').click();await login.p.locator('#code').fill('12345678');await login.p.locator('#codeForm button[type=submit]').click();await login.p.locator('#dashboard').waitFor({state:'visible'});
  assert.equal(login.calls.find(x=>x.action==='owner.verify').newToken.length,43);
  assert.equal(await login.p.locator('.lead').count(),2);
  assert.equal(await login.p.locator('#welcome').isVisible(),false);
  await login.p.locator('#enablePush').click();await login.p.waitForFunction(()=>document.querySelector('#pushHeading').textContent==='Phone alerts are on');
  assert.ok(login.calls.some(x=>x.action==='owner.subscribe'));
  await login.p.locator('#testPush').click();await login.p.waitForFunction(()=>document.querySelector('#notice').textContent.includes('Test accepted'));
  await login.p.screenshot({path:'/tmp/mftnb-owner-inbox.png',fullPage:true});
  await login.p.getByRole('button',{name:/Jamie Thompson/}).click();await login.p.locator('#leadDialog').waitFor({state:'visible'});
  assert.equal(await login.p.locator('#contactActions a').first().getAttribute('href'),'tel:5555550100');
  assert.equal(await login.p.locator('#detailFields img').count(),0);assert.equal(await login.p.evaluate(()=>window.__xss),undefined);
  await login.p.locator('#leadStatus').selectOption('contacted');await login.p.waitForFunction(()=>document.querySelector('#detailNotice').textContent==='Status saved.');
  await login.p.screenshot({path:'/tmp/mftnb-owner-lead.png',fullPage:true});await login.p.locator('#closeDetail').click();assert.equal(await login.p.locator('.lead').count(),1);
  assert.equal(await login.p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await login.p.locator('#logout').click();await login.p.locator('#login').waitFor({state:'visible'});assert.equal(await login.p.locator('#leadList .lead').count(),0);await login.ctx.close();
  const iphone=await page({signedIn:true,ios:true});await iphone.p.locator('#dashboard').waitFor({state:'visible'});assert.equal(await iphone.p.locator('#enablePush').isDisabled(),true);assert.match(await iphone.p.locator('#pushHelp').textContent(),/home screen/);await iphone.ctx.close();
  const setup=await page({setup:false});assert.equal(await setup.p.locator('#login').isVisible(),false);assert.match(await setup.p.locator('#notice').textContent(),/being connected/);await setup.ctx.close();
  const desktop=await page({signedIn:true,width:1280});await desktop.p.locator('#dashboard').waitFor({state:'visible'});await desktop.p.screenshot({path:'/tmp/mftnb-owner-desktop.png',fullPage:true});assert.equal(await desktop.p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await desktop.ctx.close();
  assert.deepEqual(errors,[]);
  console.log('PASS: owner login, session, phone enable/test, private detail rendering, status, logout, iPhone installation gate, pending setup, and mobile/desktop layout. External delivery mocked.');
 }finally{await browser.close();server.close();}
})().catch(error=>{console.error(error);server.close();process.exitCode=1;});
