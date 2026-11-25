// WEBSITE_TEST_DEPENDENCIES=/absolute/website/workspace node tests/frontend/websiteCmsContent.browser.cjs
// Uses the website's existing Playwright. All responses intercepted; no server or live publication.
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { createRequire } = require('node:module');
if (!process.env.WEBSITE_TEST_DEPENDENCIES) throw Error('Set WEBSITE_TEST_DEPENDENCIES');
const { chromium, expect } = createRequire(resolve(process.env.WEBSITE_TEST_DEPENDENCIES, 'package.json'))('@playwright/test');
const root = resolve(__dirname, '../../..');
const fixture = JSON.parse(readFileSync(resolve(root, 'backend/contracts/website/v1/fixtures/published.json')));
const clone = value => JSON.parse(JSON.stringify(value));
(async () => {
 const browser = await chromium.launch({ headless:true });
 try {
  const page=await browser.newPage({viewport:{width:1440,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const home=clone(fixture.pages.find(p=>p.path==='/'));home.id='shared-id';
  home.sections.push({type:'intro',id:'rich',heading:'Rich content',body:[{type:'paragraph',content:[{type:'text',text:'Plain '},{type:'strong',text:'Bold'},{type:'emphasis',text:'Emphasis'},{type:'link',text:'Link',href:'/contact'}]},{type:'list',ordered:true,items:[[{type:'text',text:'First item'}]]}]});
  const officer={...clone(fixture.officers[0]),id:'shared-id',name:'Review Officer'};
  const make=(kind,id,content,published=true)=>({entity:{kind,id},latest:{revisionId:`${kind}-original`,content:clone(content)},published:published?{revisionId:`${kind}-original`,content:clone(content)}:null,revisions:[{revisionId:`${kind}-original`,content:clone(content)}]});
  const entries={page:make('page',home.id,home),officer:make('officer',officer.id,officer,false),site:make('site','company-settings',fixture.site)};
  let version=0;let publication={publicationId:'pub-original',generation:1};let failSave=false;let lastPublish;
  await page.route('http://127.0.0.1:3499/**',async route=>{
   const request=route.request(),url=new URL(request.url()),json=data=>route.fulfill({json:data});
   if(url.pathname==='/website-cms.html')return route.fulfill({contentType:'text/html',body:readFileSync(resolve(root,'website-cms.html'),'utf8').replace(/<script data-dashboard-auth\b[^>]*><\/script>/g,'').replace('name="website-cms-csrf" content=""','name="website-cms-csrf" content="synthetic"')});
   if(url.pathname.startsWith('/js/')||url.pathname.startsWith('/css/'))return route.fulfill({contentType:url.pathname.endsWith('.css')?'text/css':'application/javascript',body:readFileSync(resolve(root,`.${url.pathname}`),'utf8')});
   if(url.pathname==='/api/website-cms/hero-library')return route.fulfill({status:404,json:{error:'unconfigured'}});
   if(url.pathname==='/api/website-cms/entities')return json({entities:Object.values(entries).map(e=>({kind:e.entity.kind,id:e.entity.id,path:e.latest.content.path,title:e.latest.content.title||e.latest.content.name||'Company contact',publishedRevisionId:e.published?.revisionId})),publication});
   const match=/^\/api\/website-cms\/entities\/(page|officer|site)\/([^/]+)(\/revisions)?$/.exec(url.pathname);
   if(match){const e=entries[match[1]];assert.equal(decodeURIComponent(match[2]),e.entity.id);
    if(request.method()==='GET')return json({...clone(e),publication,photoAssets:[officer.photoAsset]});
    if(failSave){failSave=false;return route.fulfill({status:409,json:{error:'conflict'}});}
    const body=request.postDataJSON();assert.equal(body.baseRevisionId,e.latest.revisionId);e.latest={revisionId:`draft-${++version}`,content:body.content};e.revisions.push(clone(e.latest));return json({revisionId:e.latest.revisionId});
   }
   if(url.pathname==='/api/website-cms/publications'){lastPublish=request.postDataJSON();const selection=lastPublish.selections[0],e=entries[selection.kind];e.published=clone(e.revisions.find(r=>r.revisionId===selection.revisionId));publication={publicationId:`pub-${version}`,generation:publication.generation+1};return json(publication);}
   return route.fulfill({status:404,body:''});
  });
  await page.goto('http://127.0.0.1:3499/website-cms.html');await expect(page.locator('#status')).toContainText('Ready to edit');
  const i=home.sections.length-1,q=home.sections.findIndex(s=>s.type==='faq');
  await page.locator(`#section-${i}-body-0-1-text`).fill('Edited bold');await page.locator(`#section-${i}-body-0-3-href`).fill('/loan-officers');await page.locator(`#section-${q}-faq-0-question`).fill('Revised question?');
  await page.locator('#save-draft').click();await expect(page.locator('#status')).toContainText('Draft saved');
  assert.equal(entries.page.latest.content.sections[i].body[0].content[1].type,'strong');assert.equal(entries.page.latest.content.sections[i].body[0].content[1].text,'Edited bold');assert.equal(entries.page.latest.content.sections[i].body[0].content[3].href,'/loan-officers');assert.equal(entries.page.latest.content.sections[i].body[1].ordered,true);
  assert.equal(entries.page.published.content.sections[q].items[0].question,home.sections[q].items[0].question);await expect(page.locator('#revision-preview')).toContainText('Revised question?');
  const saved=entries.page.latest.revisionId;await page.locator(`#section-${q}-faq-0-question`).fill('Unsaved question');await page.locator('#review-publish').click();await page.locator('#confirm-publish').click();await expect(page.locator('#status')).toContainText('Published');assert.equal(lastPublish.selections[0].revisionId,saved);assert.equal(entries.page.published.content.sections[q].items[0].question,'Revised question?');await expect(page.locator(`#section-${q}-faq-0-question`)).toHaveValue('Unsaved question');
  page.once('dialog',dialog=>dialog.accept());await page.locator('#page-picker').selectOption(JSON.stringify(['officer','shared-id']));await expect(page.locator('#officer-name')).toHaveValue('Review Officer');await expect(page.locator('#page-only-fields')).toBeHidden();await page.locator('#officer-biography').fill('Updated profile biography.');await page.locator('#save-draft').click();await expect(page.locator('#status')).toContainText('Draft saved');assert.equal(entries.officer.latest.content.biography,'Updated profile biography.');assert.equal(entries.officer.latest.content.slug,officer.slug);
  await page.locator('#preview-page-revision').click();await expect(page.locator('#content-preview-body')).toContainText('Updated profile biography.');await page.getByRole('button',{name:'Close content preview',exact:true}).click();await page.locator('#officer-biography').fill('Unsaved officer changes');await page.locator('#review-publish').click();await page.locator('#confirm-publish').click();await expect(page.locator('#status')).toContainText('Published');assert.equal(lastPublish.selections[0].kind,'officer');
  await expect(page.locator('#page-picker option:checked')).not.toContainText('Not published');
  await expect(page.locator('#page-picker')).toHaveValue(JSON.stringify(['officer','shared-id']));
  await expect(page.locator('#officer-biography')).toHaveValue('Unsaved officer changes');
  page.once('dialog',dialog=>dialog.accept());await page.locator('#page-picker').selectOption('shared-id');
  await expect(page.getByRole('checkbox',{name:'Review Officer',exact:true})).toBeVisible();
  await page.locator('#page-picker').selectOption(JSON.stringify(['site','company-settings']));await expect(page.locator('#site-email')).toBeVisible();await page.locator('#site-email').fill('review@example.invalid');failSave=true;await page.locator('#save-draft').click();await expect(page.locator('#error')).toContainText('Another revision');await expect(page.locator('#site-email')).toHaveValue('review@example.invalid');await page.locator('#save-draft').click();await expect(page.locator('#status')).toContainText('Draft saved');assert.equal(entries.site.latest.content.contact.email,'review@example.invalid');assert.deepEqual(entries.site.latest.content.navigation,fixture.site.navigation);assert.deepEqual(entries.site.latest.content.company,fixture.site.company);
  await page.locator('#review-publish').click();await page.locator('#confirm-publish').click();await expect(page.locator('#status')).toContainText('Published');assert.equal(lastPublish.selections[0].kind,'site');await page.setViewportSize({width:390,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.deepEqual(errors,[]);
  console.log('PASS structured rich text, exact saved revision, private drafts, kind/id collision, unpublished officer, contact-only edits, conflict retention, mobile width, no browser errors');
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
