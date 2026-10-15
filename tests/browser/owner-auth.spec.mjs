import {test,expect} from '@playwright/test';
const endpoint='**/api/auth/owner/**';
async function open(page,status,body,suffix='?view=settings'){
  await page.route(endpoint,route=>route.fulfill({status,json:body,headers:{'x-ncore-auth-request-id':'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'}}));
  await page.goto('/'+suffix);
  return page.getByLabel('Google owner authentication');
}
test('disabled auth preserves local archive and gives no login control',async({page})=>{
  const panel=await open(page,503,{error:'AUTH_NOT_CONFIGURED'});
  await expect(panel).toContainText('disabled for this deployment');
  await expect(panel.getByRole('link',{name:'Sign in with Google'})).toHaveCount(0);
  await expect(page.getByLabel('Sync state: Local only')).toBeVisible();
});
test('configuration failure provides a safe support reference and recovers to guest',async({page})=>{
  const panel=await open(page,503,{error:'AUTH_UNAVAILABLE',reason:'configuration'});
  await expect(panel).toContainText('Preview configuration correction');
  await expect(panel).toContainText('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
  await page.unroute(endpoint);await page.route(endpoint,r=>r.fulfill({status:401,json:{authenticated:false}}));
  await panel.getByRole('button',{name:'Retry session check'}).click();
  await expect(panel.getByRole('link',{name:'Sign in with Google'})).toHaveAttribute('href','/api/auth/owner/start');
});
test('wrong-account callback opens settings, displays rejection and removes the URL marker',async({page})=>{
  const panel=await open(page,401,{authenticated:false},'?auth=denied');
  await expect(panel.getByRole('alert')).toContainText('not authorized');
  await expect(page).toHaveURL('http://127.0.0.1:3099/');
});
test('owner logout failure never reports signed out and a retry checks its true state',async({page})=>{
  const csrf='a'.repeat(43),expiresAt=new Date(Date.now()+600000).toISOString();let failed=false;
  await page.route(endpoint,route=>{
    if(route.request().method()==='POST'){failed=true;expect(route.request().headers()['x-ncore-csrf']).toBe(csrf);return route.fulfill({status:503,json:{error:'AUTH_UNAVAILABLE'}});}
    return route.fulfill({status:200,json:{authenticated:true,csrf,expiresAt}});
  });
  await page.goto('/?view=settings');const panel=page.getByLabel('Google owner authentication');
  await expect(panel).toContainText('Owner session active');
  await panel.getByRole('button',{name:'Sign out',exact:true}).click();
  await expect(panel).toContainText('Sign-out could not be confirmed');expect(failed).toBe(true);
  await panel.getByRole('button',{name:'Retry session check'}).click();
  await expect(panel).toContainText('Owner session active');
});
test('logout succeeds and rechecks revocation before rendering signed out',async({page})=>{
  let revoked=false;const csrf='b'.repeat(43);
  await page.route(endpoint,route=>{
    if(route.request().method()==='POST'){revoked=true;return route.fulfill({status:200,json:{loggedOut:true}});}
    return route.fulfill(revoked?{status:401,json:{authenticated:false}}:{status:200,json:{authenticated:true,csrf,expiresAt:new Date(Date.now()+600000).toISOString()}});
  });
  await page.goto('/?view=settings');const panel=page.getByLabel('Google owner authentication');
  await expect(panel).toContainText('Owner session active');await panel.getByRole('button',{name:'Sign out',exact:true}).click();
  await expect(panel).toContainText('Signed out.');expect(revoked).toBe(true);
});
test('mobile unavailable state and request reference fit the viewport',async({page})=>{
  await page.setViewportSize({width:375,height:812});
  const panel=await open(page,503,{error:'AUTH_UNAVAILABLE',reason:'storage'});
  await expect(panel).toContainText('Session storage is unavailable');
  await expect(panel.getByRole('button',{name:'Retry session check'})).toBeVisible();
  const box=await panel.boundingBox();expect(box.x+box.width).toBeLessThanOrEqual(376);
});
test('mismatched hostname never offers a login link',async({page})=>{
  const panel=await open(page,409,{error:'AUTH_ORIGIN_MISMATCH'});
  await expect(panel).toContainText('configured Preview address');await expect(panel.getByRole('link')).toHaveCount(0);
});
test('refresh replaces the CSRF token before a following logout',async({page})=>{
  let token='c'.repeat(43),revoked=false;
  await page.route(endpoint,route=>{
    const req=route.request();
    if(req.method()==='POST'){
      expect(req.headers()['x-ncore-csrf']).toBe(token);
      if(req.url().endsWith('/rotate')){token='d'.repeat(43);return route.fulfill({status:200,json:{rotated:true,csrf:token}});}
      revoked=true;return route.fulfill({status:200,json:{loggedOut:true}});
    }
    return route.fulfill(revoked?{status:401,json:{authenticated:false}}:{status:200,json:{authenticated:true,csrf:token,expiresAt:new Date(Date.now()+600000).toISOString()}});
  });
  await page.goto('/?view=settings');const panel=page.getByLabel('Google owner authentication');
  await panel.getByRole('button',{name:'Refresh session',exact:true}).click();await expect(panel).toContainText('Owner session active');
  await panel.getByRole('button',{name:'Sign out',exact:true}).click();await expect(panel).toContainText('Signed out.');
});
test('logout rechecks the session in another open tab',async({context,page})=>{
  let revoked=false;
  await context.route(endpoint,route=>{
    if(route.request().method()==='POST'){revoked=true;return route.fulfill({status:200,json:{loggedOut:true}});}
    return route.fulfill(revoked?{status:401,json:{authenticated:false}}:{status:200,json:{authenticated:true,csrf:'e'.repeat(43),expiresAt:new Date(Date.now()+600000).toISOString()}});
  });
  await page.goto('/?view=settings');const other=await context.newPage();await other.goto('/?view=settings');
  await expect(other.getByLabel('Google owner authentication')).toContainText('Owner session active');
  await page.getByRole('button',{name:'Sign out',exact:true}).click();
  await expect(other.getByLabel('Google owner authentication')).toContainText('Signed out.');
});
