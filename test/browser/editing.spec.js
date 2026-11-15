import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => { await page.goto('/'); });

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

test('a fresh sketch shows the generic project example and enum', async ({ page }) => {
  await expect(page).toHaveTitle('Entity — Object relationship sketcher');
  await expect(page.getByRole('textbox', { name: 'Sketch name', exact: true })).toHaveValue('Project model');
  await expect(page.locator('.project-name .eyebrow')).toHaveText('OBJECT RELATIONSHIPS');
  await expect(page.getByRole('article', { name: 'Project entity', exact: true })).toBeVisible();
  await expect(page.getByRole('article', { name: 'Status enum', exact: true })).toContainText('in_progress');
});

test('saved sketches from the original release migrate without losing their data', async ({ page }) => {
  await expect.poll(() => page.evaluate(() => localStorage.getItem('entity-sketch-v1'))).not.toBeNull();
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('chamdo-entity-sketch-v1', JSON.stringify({
      format: 'chamdo-entity-sketch', version: 1, name: 'Saved model',
      entities: [{ id: 'saved-person', name: 'Person', position: { x: 90, y: 90 }, properties: [{ id: 'saved-name', name: 'name', type: 'str', cardinality: 'one' }] }],
    }));
  });
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Sketch name', exact: true })).toHaveValue('Saved model');
  await expect(page.getByRole('article', { name: 'Person entity', exact: true })).toContainText('name');
  await expect.poll(() => page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem('entity-sketch-v1') || 'null');
    return saved && { format: saved.format, name: saved.name, entityId: saved.entities[0].id, propertyId: saved.entities[0].properties[0].id };
  })).toEqual({ format: 'entity-sketch', name: 'Saved model', entityId: 'saved-person', propertyId: 'saved-name' });
});

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
  await add(input, 'items Item *');
  await page.getByRole('button', { name: 'Hide inspector', exact: true }).click();
  await page.keyboard.press('Enter');
  input = page.getByRole('textbox', { name: 'TestState property editor', exact: true });
  await expect(input).toBeFocused();
  await expect(page.locator('.inspector')).toHaveCount(0);
  await input.press('ArrowUp');
  await expect(input).toHaveValue('items Item *');
  await input.press('ArrowRight');
  const itemInput = page.getByRole('textbox', { name: 'Item property editor', exact: true });
  await expect(itemInput).toBeFocused();
  await add(itemInput, 'name');
  await itemInput.press('ArrowLeft');
  await expect(input).toBeFocused();
  await expect(input).toHaveValue('items Item *');
  await expect(page.locator('.inspector')).toHaveCount(0);
  await page.screenshot({ path: '/tmp/entity-inline-editing.png' });
});

test('inspector edits are mirrored in the active graph row', async ({ page }) => {
  const input = await newEntity(page);
  await add(input, 'count int');
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
  await add(input, 'status enum');
  await input.press('ArrowRight');
  const values = page.getByRole('textbox', { name: 'Status value editor', exact: true });
  await expect(values).toBeFocused();
  for (const value of ['draft', 'active', 'archived']) await add(values, value);
  const card = page.getByRole('article', { name: 'Status enum', exact: true });
  await expect(card.locator('.card-property')).toHaveCount(3);
  await expect(card.locator('.property-type')).toHaveCount(0);
  await expect(page.locator('.enum-edge')).toHaveCount(1);
  await values.press('ArrowUp');
  await expect(values).toHaveValue('archived');
  await values.pressSequentially('deleted');
  await values.press('Enter');
  await expect(card.locator('.card-property')).toHaveCount(3);
  await values.press('ArrowLeft');
  await expect(input).toBeFocused();
  await input.press('Escape');
  await page.keyboard.press('Space');
  await page.keyboard.press('x');
  const exported = JSON.parse(await page.getByLabel('Export preview').inputValue());
  const enumeration = exported.entities.find(e => e.kind === 'enum');
  expect(enumeration.name).toBe('Status');
  expect(enumeration.values.map(v => v.value)).toEqual(['draft', 'active', 'deleted']);
  expect(enumeration.properties).toBeUndefined();
  expect(exported.entities[0].properties[0].type).toBe('Status');
  await page.getByRole('button', { name: /PlantUML/ }).click();
  await expect(page.getByLabel('Export preview')).toHaveValue(/enum Status/);
});
