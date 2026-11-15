import { test as base, expect } from '@playwright/test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';

// Use Shuttle's leased session endpoint so these checks never touch personal tabs.
const test = base.extend({
  context: async ({ playwright, launchOptions, headless, baseURL, viewport }, use) => {
    const profile = await mkdtemp(join(tmpdir(), 'entity-shuttle-test-'));
    const host = spawn(launchOptions.executablePath, [`--user-data-dir=${profile}`, '--remote-debugging-port=0', '--disable-crashpad-for-testing', ...(headless ? ['--headless'] : [])], { stdio: 'ignore' });
    try {
      await expect.poll(async () => readFile(join(profile, 'DevToolsActivePort'), 'utf8').catch(() => ''), { timeout: 10000 }).not.toBe('');
      const { stdout } = await promisify(execFile)('shuttle-ctl', ['open', 'entity-test', baseURL, '--udd', profile]).catch(error => {
        if (error.stdout?.includes('"sessionId"')) return { stdout: error.stdout };
        throw new Error(`Shuttle session failed: ${error.stdout || error.stderr || error.message}`);
      });
      const session = JSON.parse(stdout);
      if (!session.loaded) {
        await promisify(execFile)('shuttle-ctl', ['call', 'open', `targetId=${session.targetId}`, `url=${baseURL}`, '--udd', profile]);
      }
      const browser = await playwright.chromium.connectOverCDP(session.cdpEndpoint);
      const context = browser.contexts()[0];
      await context.pages()[0].setViewportSize(viewport);
      await use(context);
    } finally {
      if (host.exitCode === null && host.signalCode === null) {
        const stopped = new Promise(resolve => host.once('exit', resolve));
        host.kill('SIGTERM');
        const timeout = setTimeout(() => host.kill('SIGKILL'), 5000);
        await stopped;
        clearTimeout(timeout);
      }
      await rm(profile, { recursive: true, force: true });
    }
  },
  page: async ({ context }, use) => { await use(context.pages()[0]); },
});

async function newEntity(page, name = 'TestState') {
  await page.getByRole('button', { name: 'New sketch', exact: true }).click();
  await page.getByRole('button', { name: 'Start blank' }).click();
  await page.keyboard.press('Space');
  await page.keyboard.press('n');
  await page.getByRole('textbox', { name: 'ENTITY NAME', exact: true }).fill(name);
  await page.getByRole('textbox', { name: 'ENTITY NAME', exact: true }).press('Enter');
  const input = page.getByRole('textbox', { name: `${name} property editor`, exact: true });
  await expect(input).toBeFocused();
  return input;
}

async function add(input, text) {
  await input.fill(text);
  await input.press('Enter');
  await expect(input).toHaveValue('');
  await expect(input).toBeFocused();
}

test('Enter adds a row; Up selects it for overwriting in the graph', async ({ page }) => {
  const input = await newEntity(page);
  await add(input, 'PropName');
  await input.press('ArrowUp');
  await expect(input).toHaveValue('PropName');
  await expect.poll(() => input.evaluate(el => [el.selectionStart, el.selectionEnd])).toEqual([0, 8]);
  await input.pressSequentially('NewProp');
  await expect(input).toHaveValue('NewProp');
  await expect(page.locator('#property-input')).toHaveValue('NewProp');
  await expect(page.locator('.entity-card.editing .card-edit-row')).toHaveCount(1);
  await input.press('Enter');
  await expect(input).toHaveValue('');
  await expect(input).toBeFocused();
  await expect(page.locator('.entity-card.selected .card-property')).toHaveCount(1);
  await expect(page.locator('.entity-card.selected .card-property')).toContainText('NewProp');
  await expect(page.getByRole('form', { name: 'New property row' })).toBeVisible();
  await input.press('Escape');
  await page.keyboard.press('Space');
  await page.keyboard.press('x');
  const exported = JSON.parse(await page.getByLabel('Export preview').inputValue());
  expect(exported.entities[0].properties.map(p => p.name)).toEqual(['NewProp']);
});

test('Up and Down traverse rows, Enter always returns to a new row', async ({ page }) => {
  const input = await newEntity(page);
  await add(input, 'first');
  await add(input, 'second int');
  await add(input, 'third bool');
  await input.press('ArrowUp');
  await expect(input).toHaveValue('third bool');
  await input.press('ArrowUp');
  await expect(input).toHaveValue('second int');
  await input.press('ArrowUp');
  await expect(input).toHaveValue('first');
  await input.press('ArrowUp');
  await expect(input).toHaveValue('first');
  await input.press('ArrowDown');
  await expect(input).toHaveValue('second int');
  await input.pressSequentially('updated float');
  await input.press('ArrowDown');
  await expect(input).toHaveValue('third bool');
  await expect(page.locator('.entity-card.selected .card-property').filter({ hasText: 'updated' })).toContainText('float');
  await input.press('Enter');
  await expect(input).toHaveValue('');
  await expect(page.locator('.entity-card.selected .card-property')).toHaveCount(3);
});

test('Left and Right follow entity links and work with the inspector hidden', async ({ page }) => {
  let input = await newEntity(page);
  await add(input, 'units Unit *');
  await page.getByRole('button', { name: 'Hide inspector', exact: true }).click();
  await page.keyboard.press('Enter');
  input = page.getByRole('textbox', { name: 'TestState property editor', exact: true });
  await expect(input).toBeFocused();
  await expect(page.locator('.inspector')).toHaveCount(0);
  await input.press('ArrowUp');
  await expect(input).toHaveValue('units Unit *');
  await input.press('ArrowRight');
  const unitInput = page.getByRole('textbox', { name: 'Unit property editor', exact: true });
  await expect(unitInput).toBeFocused();
  await add(unitInput, 'name');
  await unitInput.press('ArrowLeft');
  await expect(input).toBeFocused();
  await expect(input).toHaveValue('units Unit *');
  await expect(page.locator('.inspector')).toHaveCount(0);
  await page.screenshot({ path: '/tmp/entity-inline-editing.png' });
});

test('inspector edits are mirrored in the active graph row', async ({ page }) => {
  const input = await newEntity(page);
  await add(input, 'strength int');
  await page.locator('.inspector-property-name').click();
  const sidebar = page.locator('#property-input');
  await expect(sidebar).toBeFocused();
  await sidebar.pressSequentially('morale float');
  await expect(input).toHaveValue('morale float');
  await expect(page.locator('.entity-card.editing .card-edit-row')).toHaveCount(1);
  await sidebar.press('Enter');
  await expect(sidebar).toHaveValue('');
  await expect(sidebar).toBeFocused();
  await expect(page.locator('.entity-card.selected .card-property')).toHaveCount(1);
  await expect(page.locator('.entity-card.selected .card-property')).toContainText('morale');
  await expect(page.getByRole('form', { name: 'New property row' })).toBeVisible();
});

test('invalid edits block arrow navigation and remain visible on the graph', async ({ page }) => {
  const input = await newEntity(page);
  await add(input, 'name');
  await input.press('ArrowUp');
  await input.fill('bad-name int');
  await input.press('ArrowDown');
  await expect(input).toHaveValue('bad-name int');
  await expect(page.locator('.entity-card.editing .card-editor-error')).toContainText('property name');
  await input.press('Escape');
  await expect(page.locator('.card-edit-row')).toHaveCount(0);
  await expect(page.locator('.entity-card.selected .card-property')).toContainText('name');
});

test('enums have value-only editors, distinct links and structured exports', async ({ page }) => {
  const input = await newEntity(page);
  await add(input, 'organisation enum');
  await input.press('ArrowRight');
  const values = page.getByRole('textbox', { name: 'Organisation value editor', exact: true });
  await expect(values).toBeFocused();
  for (const value of ['ready', 'disorganised', 'routed']) await add(values, value);
  const card = page.getByRole('article', { name: 'Organisation enum', exact: true });
  await expect(card.locator('.card-property')).toHaveCount(3);
  await expect(card.locator('.property-type')).toHaveCount(0);
  await expect(page.locator('.enum-edge')).toHaveCount(1);
  await values.press('ArrowUp');
  await expect(values).toHaveValue('routed');
  await values.pressSequentially('retreating');
  await values.press('Enter');
  await expect(card.locator('.card-property')).toHaveCount(3);
  await values.press('ArrowLeft');
  await expect(input).toBeFocused();
  await input.press('Escape');
  await page.keyboard.press('Space');
  await page.keyboard.press('x');
  const exported = JSON.parse(await page.getByLabel('Export preview').inputValue());
  const enumeration = exported.entities.find(e => e.kind === 'enum');
  expect(enumeration.name).toBe('Organisation');
  expect(enumeration.values.map(v => v.value)).toEqual(['ready', 'disorganised', 'retreating']);
  expect(enumeration.properties).toBeUndefined();
  expect(exported.entities[0].properties[0].type).toBe('Organisation');
  await page.getByRole('button', { name: /PlantUML/ }).click();
  await expect(page.getByLabel('Export preview')).toHaveValue(/enum Organisation/);
});
