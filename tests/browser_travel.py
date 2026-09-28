"""Real Chromium DOM/layout tests; Google Maps, Turnstile and submissions are mocked.
Run: python tests/browser_travel.py (pip install playwright; playwright install chromium).
No live customer submissions, API keys, addresses or Google requests are used.
"""
from contextlib import contextmanager
from pathlib import Path
import json
import os
import re
import shutil
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
HTML = re.sub(r'<script[\s\S]*?</script>|<link[^>]*>|<iframe[\s\S]*?</iframe>|<img[^>]*>', '', (ROOT / 'index.html').read_text())
CSS = '\n'.join((ROOT / name).read_text() for name in ['styles.css','estimator.css'])
FIXTURE = dict(moveType='transport', name='Test Customer', email='test@example.com', phone='4035550100',
    fromAddress='123 Main Street, Red Deer, AB, Canada', toAddress='123 Main Street, Blackfalds, AB, Canada',
    onSiteDetails='Basement to garage', homeType='Single-family home', bedrooms='3 bedrooms',
    boxCount=100, smallItemCount=20, twoPersonItems=20, fragileItems=5, carryDistance=15,
    stairsFrom=0.5, stairsTo=0, elevatorAccess='Not needed / ground floor', parkingDistance='Street parking',
    accessDetails='Keep the side door clear', moveDate='2099-01-01', moveTime='Flexible / unsure',
    season='Normal / not sure', priorityQuiz='Keep costs lean', specialItems='Test piano',
    extraServices=['Furniture assembly / disassembly'], notes='Synthetic data only')
MOCKS = r"""({seed,configured,confirmed,routeMode})=>{
    const memory=initial=>{const data={...initial};return {getItem:key=>data[key]??null,setItem:(key,value)=>{data[key]=String(value)},removeItem:key=>{delete data[key]}}};
    Object.defineProperty(window,'sessionStorage',{value:memory(seed ? {'mftnb-estimate-v4':JSON.stringify(seed)} : {})});
    Object.defineProperty(window,'localStorage',{value:memory({})});
    window.__widgets=[]; window.__posts=[]; window.__routeCalls=[]; window.__pendingRoutes=[];window.__placeRequests=[];
    window.__routeMode=routeMode;
    window.fetch=async(url,options)=>{window.__posts.push(JSON.parse(options.body));return new Response('{"ok":true}',{status:200})};
    window.turnstile={render(selector,options){const id=__widgets.length;__widgets.push(options);queueMicrotask(()=>options.callback('test-token-'+id));return id;},reset(id){__widgets[id].callback('fresh-test-token')}};
    window.MFTNB_MAPS_CONFIG={browserKey:configured?'test-browser-key':'',shop:{formattedAddress:'Synthetic shop, Test Town',municipality:'Test Town',unit:'806',lat:52.30,lng:-113.84,confirmed,confirmedBy:'Test owner',confirmedAt:new Date().toISOString()}};
    class Autocomplete extends HTMLElement {
        constructor(){super();this.attachShadow({mode:'open'});this.control=document.createElement('input');this.control.placeholder='Search street address and town';this.control.style.cssText='width:100%;box-sizing:border-box;padding:14px;font:16px sans-serif';this.shadowRoot.append(this.control);this.control.addEventListener('input',()=>this.dispatchEvent(new Event('input',{bubbles:true,composed:true})));}
        get value(){return this.control.value} set value(v){this.control.value=v}
        focus(){this.control.focus()}
    }
    customElements.define('gmp-place-autocomplete',Autocomplete);
    class Place {constructor({id}){this.id=id;}}
    const Route={computeRoutes(request){
        __routeCalls.push(request);
        const response={routes:[{legs:(request.intermediates.length===2?[600,1200,900]:[600,900]).map(s=>({durationMillis:s*1000,distanceMeters:s*10})),warnings:['Synthetic road-access note']} ]};
        if(__routeMode==='failure')return Promise.reject(new Error('REQUEST_DENIED'));
        if(__routeMode==='empty')return Promise.resolve({routes:[]});
        if(__routeMode==='deferred')return new Promise((resolve,reject)=>__pendingRoutes.push({resolve,reject,response}));
        return Promise.resolve(response);
    }};
    window.google={maps:{importLibrary:async name=>name==='places'?{PlaceAutocompleteElement:Autocomplete,Place}:{Route}}};
    window.__choose=(town,id,delay=false)=>{
        const widget=document.querySelector('gmp-place-autocomplete');
        const place={id,formattedAddress:`123 Main Street, ${town}, AB, Canada`,types:['street_address'],addressComponents:[{longText:'123',types:['street_number']},{longText:town,types:['locality']}],location:{lat:()=>town==='Red Deer'?52.27:52.38,lng:()=>-113.81},fetchFields(){return delay?new Promise(resolve=>__placeRequests.push(resolve)):Promise.resolve()}};
        const event=new Event('gmp-select');event.placePrediction={toPlace:()=>place};widget.dispatchEvent(event);
    };
}"""
results=[]
with sync_playwright() as p:
    @contextmanager
    def page_case(seed=None, configured=False, confirmed=False, route_mode='normal', width=390, seed_pins=False):
        browser=p.chromium.launch(executable_path=os.environ.get('MFTNB_CHROMIUM_EXECUTABLE') or shutil.which('chromium') or None,headless=True,args=['--no-sandbox','--disable-dev-shm-usage','--disable-gpu','--single-process'])
        ctx=browser.new_context(viewport={'width':width,'height':844},accept_downloads=True,is_mobile=width<768,has_touch=width<768)
        ctx.route('**/*',lambda route:route.fulfill(status=200,content_type='text/html',body='<p>Map preview mocked for test</p>') if '/maps/embed/' in route.request.url else route.abort())
        page=ctx.new_page();page.set_default_timeout(5000);errors=[];page.on('pageerror',lambda err:errors.append(str(err)))
        page.set_content(HTML);page.add_style_tag(content=CSS)
        page.evaluate(MOCKS,dict(seed=seed,configured=configured,confirmed=confirmed,routeMode=route_mode))
        page.add_script_tag(content=(ROOT/'travel.js').read_text())
        if seed_pins:
            page.evaluate("""()=>{const s=JSON.parse(sessionStorage.getItem('mftnb-estimate-v4'));for(const [id,town,placeId,lat]of [['fromAddress','Red Deer','red-deer-place',52.27],['toAddress','Blackfalds','blackfalds-place',52.38]]){
                s[MFTNBTravel.locationField(id)]=MFTNBTravel.confirmLocation(MFTNBTravel.cleanLocation({provider:'google',formattedAddress:s[id],municipality:town,unit:'2',placeId,lat,lng:-113.81}));}
                sessionStorage.setItem('mftnb-estimate-v4',JSON.stringify(s));}""")
        page.add_script_tag(content=(ROOT/'script.js').read_text());page.wait_for_function('window.__widgets.length===2')
        try:
            yield page
            assert not errors, errors
        finally:ctx.close();browser.close()
    def passed(name):results.append(name);print('PASS',name,flush=True)
    def choose(page,town,id):
        page.wait_for_selector('gmp-place-autocomplete')
        page.evaluate('([town,id])=>__choose(town,id)',[town,id])
        page.wait_for_function("document.querySelector('.address-municipality')?.textContent === " + json.dumps(town))
    def confirm_next(page,id):
        page.locator('#confirm-'+id).check();page.locator('#chatSubmit').click()

    with page_case(FIXTURE) as page:
        assert page.locator('#input-fromAddress').is_visible()
        page.locator('#input-fromAddress').fill('123 Main Street')
        page.locator('#municipality-fromAddress').fill('Red Deer');page.locator('#unit-fromAddress').fill('806')
        page.locator('#chatSubmit').click();assert 'confirm' in page.locator('#inputError').inner_text()
        confirm_next(page,'fromAddress')
        page.locator('#input-toAddress').fill('123 Main Street')
        page.locator('#municipality-toAddress').fill('Blackfalds');confirm_next(page,'toAddress')
        assert page.locator('#progressText').inner_text()=='Ready to review and send'
        assert 'Travel estimate unavailable—staff review required' in page.locator('#travelSummary').inner_text()
        assert not page.evaluate('__routeCalls.length')
        page.locator('#consent').check();page.locator('#sendEstimate').click()
        page.wait_for_function('__posts.length===1')
        payload=page.evaluate('__posts[0]');assert payload['travel']['totalSeconds'] is None
        assert 'Unit / lot: 806' in payload['notes'] and 'Blackfalds' in payload['notes']
        assert payload['pickup']=='123 Main Street, Red Deer' and payload['dropoff']=='123 Main Street, Blackfalds'
        assert payload['estimatedHours'] is None and payload['estimatedCost'] is None
    passed('manual fallback requires separate municipality and confirmation; existing submission includes complete plan')

    with page_case(FIXTURE,configured=True,confirmed=True) as page:
        choose(page,'Red Deer','red-deer-place');page.locator('#unit-fromAddress').fill('806')
        assert 'query_place_id=red-deer-place' in page.locator('.address-map-link').get_attribute('href')
        assert 'place_id%3Ared-deer-place' in page.locator('.address-map').get_attribute('src')
        page.locator('#chatSubmit').click();assert 'confirm' in page.locator('#inputError').inner_text()
        confirm_next(page,'fromAddress');choose(page,'Blackfalds','blackfalds-place');confirm_next(page,'toAddress')
        page.wait_for_function("document.querySelector('.travel-total')?.textContent.includes('45 min')")
        req=page.evaluate('__routeCalls[0]');assert [v['location']['id'] for v in req['intermediates']]==['red-deer-place','blackfalds-place']
        assert req['origin']==req['destination'] and req['optimizeWaypointOrder'] is False
        assert page.locator('.travel-legs li').count()==3
        assert 'Synthetic road-access note' in page.locator('#travelSummary').inner_text()
        assert 'pending' in page.locator('#cheatSheetText').inner_text()
        with page.expect_download() as download:page.locator('#downloadCheatSheet').click()
        content=Path(download.value.path()).read_text();assert 'Total estimated travel: 45 min' in content and 'Unit / lot: 806' in content
        page.locator('#consent').check();page.locator('#sendEstimate').click();page.wait_for_function('__posts.length===1')
        payload=page.evaluate('__posts[0]');assert payload['travel']['totalSeconds']==2700
        assert 'Drop-off → shop: 15 min' in payload['notes'] and payload['estimatedBillableJobHours'] is None
    passed('duplicate street addresses in two towns retain separate pins, ordered travel legs, download and legacy submission')

    with page_case(FIXTURE,configured=True,confirmed=True,seed_pins=True) as page:
        page.wait_for_selector('.travel-total');page.locator('#consent').check()
        page.get_by_role('button',name='Edit Destination address in summary',exact=True).click()
        page.wait_for_selector('gmp-place-autocomplete')
        page.locator('gmp-place-autocomplete input').fill('123 Main Street Sylvan Lake')
        assert not page.locator('.travel-total').count()
        assert not page.locator('#confirm-toAddress').is_checked()
        assert page.locator('#sendEstimate').is_disabled()
        page.locator('#chatSubmit').click();assert 'Select an address' in page.locator('#inputError').inner_text()
        choose(page,'Sylvan Lake','sylvan-place');confirm_next(page,'toAddress')
        page.wait_for_selector('.travel-total');assert page.evaluate('__routeCalls.length')==2
        page.get_by_role('button',name='Edit Destination address in summary',exact=True).click()
        page.locator('#unit-toAddress').fill('99');assert not page.locator('.travel-total').count()
        assert not page.locator('#confirm-toAddress').is_checked()
    passed('typing a new town or editing only the unit immediately clears confirmation and old travel')

    with page_case(FIXTURE,configured=True,confirmed=True,seed_pins=True,route_mode='deferred') as page:
        page.wait_for_function('__routeCalls.length===1')
        page.locator('#consent').check();assert page.locator('#sendEstimate').is_disabled()
        page.get_by_role('button',name='Edit Destination address in summary',exact=True).click()
        choose(page,'Sylvan Lake','sylvan-place');confirm_next(page,'toAddress');page.wait_for_function('__routeCalls.length===2')
        page.evaluate('__pendingRoutes[0].resolve(__pendingRoutes[0].response)')
        assert not page.locator('.travel-total').count()
        page.evaluate('__pendingRoutes[1].resolve(__pendingRoutes[1].response)');page.wait_for_selector('.travel-total')
        assert page.locator('#sendEstimate').is_enabled()
    passed('late route response cannot overwrite changed addresses; send waits for current calculation')

    with page_case(FIXTURE,configured=True,confirmed=True) as page:
        page.wait_for_selector('gmp-place-autocomplete')
        page.evaluate("__choose('Red Deer','old-place',true)")
        page.locator('gmp-place-autocomplete input').fill('123 Main Blackfalds')
        page.evaluate('__placeRequests[0]()')
        assert not page.locator('.address-map').count()
        choose(page,'Blackfalds','new-place')
        assert 'query_place_id=new-place' in page.locator('.address-map-link').get_attribute('href')
    passed('late place-details response cannot attach an old pin to newly typed text')

    for failure in ['failure','empty']:
        with page_case(FIXTURE,configured=True,confirmed=True,seed_pins=True,route_mode=failure) as page:
            page.wait_for_selector('#travelSummary button')
            assert 'Travel estimate unavailable—staff review required' in page.locator('#travelSummary').inner_text()
            assert '0 min' not in page.locator('#travelSummary').inner_text()
            page.locator('#consent').check();assert page.locator('#sendEstimate').is_enabled()
            page.evaluate("__routeMode='normal'");page.get_by_role('button',name='Retry travel estimate').click();page.wait_for_selector('.travel-total')
    passed('denied and empty routes show unavailable, preserve staff-review submission and support retry')

    with page_case(FIXTURE,configured=True,confirmed=False,seed_pins=True) as page:
        assert not page.evaluate('__routeCalls.length')
        assert 'Shop pin: awaiting owner confirmation' in page.locator('#cheatSheetText').inner_text()
    passed('unconfirmed shop makes no Google Routes request')

    with page_case(FIXTURE,configured=True,confirmed=True) as page:
        page.wait_for_selector('gmp-place-autocomplete');page.evaluate("document.querySelector('gmp-place-autocomplete').dispatchEvent(new Event('gmp-error'))")
        assert page.locator('#input-fromAddress').is_visible()
        assert 'could not load' in page.locator('.address-note').first.inner_text()
        assert 'unavailable' in page.locator('#travelSummary').inner_text()
    passed('Google address error exposes the manual fallback instead of blocking the request')

    for move_type in ['same-property','load-only','unload-only']:
        with page_case({**FIXTURE,'moveType':move_type},configured=True,confirmed=True,seed_pins=True) as page:
            page.wait_for_selector('.travel-total')
            assert page.locator('.travel-legs li').count()==2
            assert page.evaluate('__routeCalls[0].intermediates.length')==1
            assert '25 min' in page.locator('.travel-total').inner_text()
            assert 'Blackfalds' not in page.locator('#cheatSheetText').inner_text()
    passed('all three single-property workflows include shop travel without hidden destinations')

    for width in [360,390,768,1280]:
        with page_case(FIXTURE,configured=True,confirmed=True,width=width) as page:
            choose(page,'Red Deer','red-deer-place')
            assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth'),width
            if width<721: assert page.locator('#chatForm').evaluate("el=>getComputedStyle(el).position")=='static'
            page.locator('#promptText').evaluate("el=>el.scrollIntoView({block:'start',behavior:'instant'})")
            assert page.locator('#promptText').bounding_box()['y'] >= page.locator('.site-header').bounding_box()['height'],width
            assert page.locator('.address-map').bounding_box()['width']>=200,width
            assert page.locator('#chatSubmit').bounding_box()['height']>=44,width
            assert page.locator('.address-confirm').bounding_box()['height']>=44,width
            if os.environ.get('MFTNB_SCREENSHOTS'):
                folder=Path(os.environ['MFTNB_SCREENSHOTS']);folder.mkdir(exist_ok=True,parents=True)
                page.screenshot(path=str(folder/f'address-top-{width}.png'))
                page.locator('#inputHolder').screenshot(path=str(folder/f'address-{width}.png'),style='.site-header {visibility:hidden}')
                page.locator('#travelSummary').screenshot(path=str(folder/f'travel-{width}.png'))
    passed('360/390/768/1280px layouts: no horizontal overflow, readable map and touch targets')
print(f'\n{len(results)} travel browser scenarios passed; all external services mocked.')
