// Production HTML/CSS only: no authentication calls or application mutations.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '../KingdomWeb/static');

(async () => {
  const browser = await chromium.launch({headless: true, channel: 'msedge'});
  const screenshots = fs.mkdtempSync(path.join(os.tmpdir(), 'kingdom-login-'));
  try {
    for (const [width, height] of [[1920,1080], [1366,768], [1100,800], [1024,768], [768,1024], [390,844], [320,568], [844,390]]) {
      const page = await browser.newPage({viewport: {width, height}});
      await page.route('http://kingdom.test/**', route => {
        const pathname = new URL(route.request().url()).pathname;
        if (pathname === '/') return route.fulfill({contentType: 'text/html', body: fs.readFileSync(path.join(root, 'index.html'), 'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')});
        const file = path.join(root, path.basename(pathname));
        if (!fs.existsSync(file)) return route.fulfill({status:404, body:''});
        const ext = path.extname(file);
        return route.fulfill({body:fs.readFileSync(file), contentType: ({'.css':'text/css','.svg':'image/svg+xml','.png':'image/png'})[ext] || 'application/octet-stream'});
      });
      await page.goto('http://kingdom.test/');
      await page.evaluate(() => { document.querySelector('#login-screen').hidden = false; });
      await page.locator('[name=username]').fill('testeur');
      await page.locator('[name=password]').fill('test-UI-seulement');
      assert.equal(await page.locator('.module-ribbon article').count(), 5);
      assert(await page.locator('.login-input input').first().evaluate(el => parseFloat(getComputedStyle(el).fontSize) >= 16));
      assert(await page.locator('#login-screen').evaluate(el => el.scrollWidth <= el.clientWidth + 1), `${width}: horizontal overflow`);
      for (const selector of ['[name=username]', '[name=password]', '.login-submit']) {
        const control = page.locator(selector);
        await control.scrollIntoViewIfNeeded();
        assert(await control.evaluate(el => {
          const r = el.getBoundingClientRect();
          const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
          return r.x >= 0 && r.right <= innerWidth + 1 && r.y >= 0 && r.bottom <= innerHeight + 1 && (hit === el || el.contains(hit));
        }), `${width}: clipped or obscured ${selector}`);
      }
      if (width === 1920 || width === 390) {
        await page.locator('#login-screen').evaluate(el => { el.scrollTop = 0; });
        await page.screenshot({path: path.join(screenshots, `${width}.png`)});
      }
      console.log(`PASS login ${width}x${height}`);
      await page.close();
    }
    console.log(`Screenshots: ${screenshots}`);
  } finally { await browser.close(); }
})().catch(error => {console.error(error); process.exitCode=1;});
