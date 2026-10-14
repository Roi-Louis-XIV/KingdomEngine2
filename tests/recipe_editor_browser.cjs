const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');

(async () => {
  const browser = await chromium.launch({headless: true, channel: process.env.BROWSER_CHANNEL || 'msedge'});
  const page = await browser.newPage({viewport: {width: 1440, height: 1000}});
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto(process.env.KINGDOM_TEST_URL || 'http://127.0.0.1:8765/');
    await page.locator('#login-form [name=username]').fill('admin');
    await page.locator('#login-form [name=password]').fill('change-me');
    await page.locator('#login-form').evaluate(form => form.requestSubmit());
    await page.locator('#login-screen').waitFor({state: 'hidden', timeout: 15000});
    await page.locator('[data-type="building"]').click();
    await page.locator('#cards .card').first().waitFor({timeout: 15000});
    await page.locator('#cards .card [data-edit]').first().click();
    await page.locator('[data-building-tab="mechanics"]').click({force: true});
    await page.locator('[data-building-panel="mechanics"]').evaluate(panel => panel.hidden = false);
    await page.locator('#add-recipe').evaluate(button => button.click());
    await page.locator('#recipe-modules .recipe-module').last().evaluate(recipe => {
      recipe.querySelector('[data-field="recipe_name"]').value = 'Recette navigateur';
      const output = recipe.querySelector('[data-field="recipe_output"]');
      output.selectedIndex = 1;
    });
    await page.locator('#save').evaluate(button => button.click());
    await page.locator('#editor').waitFor({state: 'hidden', timeout: 15000});
    assert.deepEqual(errors, []);
    console.log('PASS recipe create/save');
  } catch (error) {
    console.error('PAGE ERRORS', errors);
    console.error('UI ERROR', await page.locator('#error').textContent().catch(() => ''), await page.locator('#login-error').textContent().catch(() => ''));
    throw error;
  } finally {
    await browser.close();
  }
})();
