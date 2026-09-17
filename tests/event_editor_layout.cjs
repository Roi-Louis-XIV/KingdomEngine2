// Browser regression: production HTML/CSS, isolated from accounts and Discord.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '../KingdomWeb/static');

(async () => {
  const browser = await chromium.launch({headless: true, channel: process.env.BROWSER_CHANNEL || 'msedge'});
  try {
    for (const mode of ['event', 'building']) {
    for (const [width, height] of [[2523, 1257], [1366, 768], [768, 1024], [390, 844]]) {
      const page = await browser.newPage({viewport: {width, height}});
      await page.route('http://kingdom.test/**', route => {
        const pathname = new URL(route.request().url()).pathname;
        if (pathname.endsWith('.css')) return route.fulfill({contentType: 'text/css', body: fs.readFileSync(path.join(root, path.basename(pathname)))});
        if (pathname !== '/') return route.fulfill({status: 404, body: ''});
        const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
        return route.fulfill({contentType: 'text/html', body: html});
      });
      await page.goto('http://kingdom.test/');
      await page.evaluate(mode => {
        const panel = document.querySelector('.wizard-panel');
        panel.closest('.modal').hidden = false;
        panel.classList.add(`${mode}-mode`);
        if (mode === 'building') {
          panel.querySelector('.editor-layout').insertAdjacentHTML('afterbegin', '<aside class="building-workbench-nav">Bâtiments</aside>');
        }
        document.querySelector('#definition-step').hidden = false;
        document.querySelector('#type-fields').innerHTML = '<nav class="event-editor-index"><a href="#event-advanced">5 · Avancé</a></nav>' +
          Array.from({length: 4}, (_, i) => `<section class="form-section" style="min-height:300px">Section ${i + 1}</section>`).join('') +
          '<section id="event-advanced" class="form-section event-advanced-section"><h3>Paramètres avancés</h3><details class="advanced"><summary>Afficher les propriétés supplémentaires (JSON)</summary><div class="advanced-content"><label>Propriétés supplémentaires<textarea rows="12">{}</textarea></label></div></details></section>';
      }, mode);
      const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
      const navStart = app.indexOf("    root.querySelectorAll('.event-editor-index a')");
      const navEnd = app.indexOf('    (payload.effects || [])', navStart);
      await page.evaluate(`{ const root = document.querySelector('#type-fields'); ${app.slice(navStart, navEnd)} }`);
      await page.locator('.event-editor-index a').click();
      assert(await page.locator('#event-advanced details').evaluate(el => el.open));
      assert.equal(new URL(page.url()).hash, '');
      const field = page.locator('#event-advanced textarea');
      await field.scrollIntoViewIfNeeded();
      await field.fill('{"custom": true}');
      const fieldBox = await field.boundingBox();
      const footerBox = await page.locator('#editor-form > .actions').boundingBox();
      assert(fieldBox.y >= 0 && fieldBox.y + fieldBox.height <= footerBox.y + 1, `${width}: advanced field obscured by footer`);
      assert(footerBox.y + footerBox.height <= height + 1, `${width}: footer outside viewport`);
      console.log(`PASS ${mode} ${width}x${height}: advanced settings editable, footer visible`);
      await page.close();
    }
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
