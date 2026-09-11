"""DOM/submission regressions. Runs offline with mocked storage, fetch and Turnstile; no live leads.
Run: python tests/browser_smoke.py (requires Playwright and Chromium).
This suite checks behavior, not pixel-level layout or a live email/Sheets delivery.
"""
from contextlib import contextmanager
from pathlib import Path
import json
import re
import shutil
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
HTML = re.sub(r'<script[\s\S]*?</script>|<link[^>]*>|<iframe[\s\S]*?</iframe>|<img[^>]*>', '', (ROOT / 'index.html').read_text())
FIXTURE = dict(moveType='same-property', name='Test Customer', email='test@example.com', phone='4035550100',
    fromAddress='123 Test Street, Red Deer, AB', onSiteDetails='Basement to garage', homeType='Single-family home',
    bedrooms='3 bedrooms', boxCount=100, smallItemCount=20, twoPersonItems=20, fragileItems=5, carryDistance=15,
    stairsFrom=0.5, elevatorAccess='Not needed / ground floor', parkingDistance='Street parking',
    accessDetails='Keep the side door clear', moveDate='2099-01-01', moveTime='Flexible / unsure',
    season='Normal / not sure', priorityQuiz='Keep costs lean', specialItems='Test piano',
    extraServices=['Furniture assembly / disassembly'], notes='Test note; no live customer data')
results=[]

with sync_playwright() as p:
    browser=p.chromium.launch(executable_path=shutil.which('chromium') or None, headless=True, args=['--no-sandbox'])
    @contextmanager
    def page_case(seed=None, response='{"ok":true}', legacy=None):
        ctx=browser.new_context(viewport={'width':360,'height':800}, accept_downloads=True)
        page=ctx.new_page(); errors=[]
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.set_content(HTML)
        page.evaluate("""({seed,legacy,response})=>{
            const memory=initial=>{const data={...initial};return {getItem:key=>data[key]??null,setItem:(key,value)=>{data[key]=String(value)},removeItem:key=>{delete data[key]}}};
            Object.defineProperty(window,'sessionStorage',{value:memory(seed ? {'mftnb-estimate-v4':JSON.stringify(seed)} : {})});
            Object.defineProperty(window,'localStorage',{value:memory(legacy ? {'mftnb-estimate-v3':JSON.stringify(legacy)} : {})});
            window.__widgets=[]; window.__resets=[]; window.__posts=[];
            window.fetch=async (url,options)=>{window.__posts.push(JSON.parse(options.body)); await new Promise(resolve=>setTimeout(resolve,30)); return new Response(response,{status:200})};
            window.turnstile={render(selector, options){const id=window.__widgets.length;window.__widgets.push(options);queueMicrotask(()=>options.callback('test-token-'+id));return id;},
              reset(id){window.__resets.push(id);window.__widgets[id].callback('fresh-test-token-'+id);}};
        }""", dict(seed=seed,legacy=legacy,response=response))
        page.add_script_tag(content=(ROOT/'script.js').read_text())
        page.wait_for_function('window.__widgets.length === 2')
        class Posts:
            def __len__(self): return page.evaluate('window.__posts.length')
            def __getitem__(self,index): return page.evaluate('(i)=>window.__posts[i]',index)
        try:
            yield page,Posts()
            assert not errors, errors
        finally: ctx.close()
    def passed(name): results.append(name); print('PASS',name)

    with page_case() as (page,posts):
        assert page.locator('#input-moveType').count()==1
        assert page.locator('#estimatedCost').inner_text()=='Estimate after review'
        assert page.evaluate('document.activeElement.tagName')=='BODY'
        assert page.locator('#sendEstimate').is_disabled()
        assert not posts
    passed('empty form: no numeric estimate, no forced page focus, no unsolicited submit')

    with page_case() as (page,posts):
        while page.locator('#inputHolder [name]').count() or page.locator('#inputHolder input[type=checkbox]').count():
            control=page.locator('#inputHolder [name]').first
            if control.count():
                name=control.get_attribute('name'); value=FIXTURE[name]
                if control.evaluate('el=>el.tagName')=='SELECT': control.select_option(str(value))
                else:
                    if name=='boxCount':
                        control.fill('-1'); page.locator('#chatSubmit').click(); assert page.locator('#inputError').inner_text(); assert page.locator('#input-boxCount').count()==1
                    control.fill(str(value))
            else:
                page.get_by_label('Furniture assembly / disassembly', exact=True).check()
            page.locator('#chatSubmit').click()
        assert page.locator('#progressText').inner_text()=='Ready to review and send'
        assert '140' in page.locator('#cheatSheetText').inner_text()
        assert '4 movers' not in page.locator('#cheatSheetText').inner_text()
        assert page.locator('#sendEstimate').is_disabled()
        page.locator('#consent').check(); assert page.locator('#sendEstimate').is_enabled()
        assert not posts
    passed('complete phone-width guided flow, negative validation, fragile subset, consent gate')

    with page_case(FIXTURE) as (page,posts):
        page.get_by_role('button',name='Edit Other access details in summary',exact=True).click()
        assert page.locator('#input-accessDetails').input_value()==FIXTURE['accessDetails']
        page.locator('#input-accessDetails').fill('Updated instructions')
        page.locator('#chatSubmit').click()
        assert 'Updated instructions' in page.locator('#cheatSheetText').inner_text()
        with page.expect_download() as download: page.locator('#downloadCheatSheet').click()
        content=Path(download.value.path()).read_text()
        assert 'Updated instructions' in content and 'ESTIMATE REQUEST' in content and '$120' not in content
    passed('editing preserves textarea content; downloadable notes use current answers')

    with page_case(FIXTURE) as (page,posts):
        page.get_by_role('button',name='Edit Kind of move in summary',exact=True).click()
        page.locator('#input-moveType').select_option('transport'); page.locator('#chatSubmit').click()
        page.locator('#input-toAddress').fill('123 TEST STREET Red Deer AB.'); page.locator('#chatSubmit').click()
        assert 'match' in page.locator('#inputError').inner_text()
        page.locator('#input-toAddress').fill('456 Other Street, Red Deer, AB'); page.locator('#chatSubmit').click()
        assert page.locator('#input-stairsTo').count()==1
        page.locator('#input-stairsTo').fill('0.5');page.locator('#chatSubmit').click()
        assert page.locator('#progressText').inner_text()=='Ready to review and send'
    passed('changing scope adds route questions and rejects identical transport addresses')

    with page_case(FIXTURE,response='<html>Sign in</html>') as (page,posts):
        page.locator('#consent').check(); page.locator('#sendEstimate').click()
        page.wait_for_function("document.querySelector('#estimateStatus').classList.contains('error')")
        assert len(posts)==1 and posts[0]['estimatedCost'] is None
        assert FIXTURE['specialItems'] in posts[0]['notes'] and FIXTURE['parkingDistance'] in posts[0]['notes']
        assert page.evaluate("JSON.parse(sessionStorage.getItem('mftnb-estimate-v4')).name")=='Test Customer'
        assert 0 in page.evaluate('window.__resets')
    passed('HTML response is not success; draft retained; complete plan preserved in legacy notes; widget ID 0 reset')

    with page_case(FIXTURE) as (page,posts):
        page.locator('#consent').check()
        page.evaluate("window.__widgets[0]['expired-callback']()")
        assert page.locator('#sendEstimate').is_disabled()
        page.evaluate("window.__widgets[0].callback('refreshed')")
        page.evaluate("document.querySelector('#sendEstimate').click();document.querySelector('#sendEstimate').click();")
        page.wait_for_function("document.querySelector('#estimateStatus').classList.contains('success')")
        assert len(posts)==1
        assert page.evaluate("sessionStorage.getItem('mftnb-estimate-v4')")=='{}'
        assert 'no price or booking is confirmed' in page.locator('#estimateStatus').inner_text()
    passed('expired tokens block send; duplicate clicks send once; only affirmative acknowledgement clears draft')

    with page_case(legacy={**FIXTURE,'fragileItems':145}) as (page,posts):
        assert page.locator('#input-moveType').count()==0  # fixture supplied a valid scope, unlike old real drafts
        assert page.locator('#input-boxCount').count()==1
        assert page.evaluate("localStorage.getItem('mftnb-estimate-v3')") is None
        assert 'Test Customer' in page.locator('#summaryList').inner_text()
    passed('legacy draft migration preserves contact details but re-asks changed inventory definitions')

    with page_case(response='{}') as (page,posts):
        page.locator('#quickName').fill('Test User'); page.locator('#quickEmail').fill('test@example.com'); page.locator('#quickMessage').fill('Not a live message')
        page.locator('#quickForm button[type=submit]').click()
        page.wait_for_function("document.querySelector('#quickStatus').classList.contains('error')")
        assert page.locator('#quickMessage').input_value()=='Not a live message'
        assert 1 in page.evaluate('window.__resets')
    passed('quick form also rejects ambiguous acknowledgement and preserves text')

    with page_case({**FIXTURE,'notes':'<img src=x onerror=alert(1)>'}) as (page,posts):
        assert page.locator('#summaryList img').count()==0
        assert '<img src=x' in page.locator('#summaryList').inner_text()
        page.get_by_role('button',name='Edit Boxes or totes in summary',exact=True).click()
        page.get_by_role('button',name='Not sure',exact=True).click()
        assert 'Not confirmed' in page.locator('#cheatSheetText').inner_text()
    passed('user text is not interpreted as HTML; unknown counts stay unknown')

    browser.close()
print(f'\n{len(results)} browser scenarios passed; no live submissions were made.')
