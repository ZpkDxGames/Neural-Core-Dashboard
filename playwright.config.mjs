import {defineConfig} from '@playwright/test';
export default defineConfig({
  reporter:[['list'],['json',{outputFile:'docs/ui/evidence/playwright-results.json'}]],
  testDir:'./tests/browser',fullyParallel:false,workers:1,timeout:30000,
  use:{baseURL:'http://127.0.0.1:3099',browserName:'chromium',screenshot:'only-on-failure',
    launchOptions:process.env.NCORE_TEST_CHROMIUM?{executablePath:process.env.NCORE_TEST_CHROMIUM,args:['--no-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']}:{}},
  webServer:{command:'npm run start -- --hostname 127.0.0.1 --port 3099',url:'http://127.0.0.1:3099/api/health',reuseExistingServer:false,env:{NCORE_OWNER_AUTH_ENABLED:'0'}},
});
