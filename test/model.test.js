import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseProperty, addProperty, addEnumValue, isEnum, entityRows, renameEntity, removeEntity, toJSON, fromJSON, toPlantUML, autoLayout, cardHeight, sampleDocument, neighbourEntity } from '../src/model.js';

const blank = () => ({ name: 'Test', entities: [{ id: 'project', name: 'Project', x: 10, y: 20, properties: [] }] });

test('property lines default to str and support primitive and class collections', () => {
  assert.deepEqual(parseProperty('name'), { name: 'name', type: 'str', many: false });
  assert.deepEqual(parseProperty('count int'), { name: 'count', type: 'int', many: false });
  assert.deepEqual(parseProperty('scores int *'), { name: 'scores', type: 'int', many: true });
  assert.deepEqual(parseProperty('  items   Item  *  '), { name: 'items', type: 'Item', many: true });
  assert.deepEqual(parseProperty('names *'), { name: 'names', type: 'str', many: true });
  assert.equal(parseProperty('draft boolean').type, 'bool');
  assert.throws(() => parseProperty('bad-name int'));
  assert.throws(() => parseProperty('name int * extra'));
  assert.throws(() => parseProperty('name * int'));
});

test('new class properties create exactly one linked entity; updates preserve IDs', () => {
  const original = blank();
  const first = addProperty(original, 'project', 'owner Person');
  assert.equal(original.entities.length, 1);
  assert.equal(first.document.entities.length, 2);
  assert.equal(first.created.name, 'Person');
  const second = addProperty(first.document, 'project', 'members person *');
  assert.equal(second.document.entities.length, 2);
  assert.equal(second.property.type, 'Person');
  assert.equal(second.property.many, true);
  const updated = addProperty(second.document, 'project', 'owner str');
  assert.equal(updated.document.entities[0].properties.length, 2);
  assert.equal(updated.property.id, first.property.id);
  assert.equal(updated.property.type, 'str');
  assert.throws(() => addProperty(second.document, 'project', 'members str', first.property.id));
});

test('self references do not create duplicate entities', () => {
  const result = addProperty(blank(), 'project', 'related Project *');
  assert.equal(result.document.entities.length, 1);
});

test('renaming updates links; deleting removes incoming properties', () => {
  const next = addProperty(blank(), 'project', 'owner Person').document;
  const personId = next.entities[1].id;
  const renamed = renameEntity(next, personId, 'Owner');
  assert.equal(renamed.entities[0].properties[0].type, 'Owner');
  assert.throws(() => renameEntity(renamed, personId, 'project'));
  assert.throws(() => renameEntity(renamed, personId, 'int'));
  const deleted = removeEntity(renamed, personId);
  assert.equal(deleted.entities.length, 1);
  assert.equal(deleted.entities[0].properties.length, 0);
});

test('JSON round trip preserves identities, positions, types and cardinalities', () => {
  const doc = sampleDocument();
  assert.deepEqual(fromJSON(toJSON(doc)), doc);
  const json = JSON.parse(toJSON(doc));
  assert.equal(json.format, 'entity-sketch');
  assert.equal(json.entities[0].properties[2].cardinality, 'many');
  assert.equal(json.entities[0].properties[0].cardinality, 'one');
  assert.deepEqual(fromJSON(JSON.stringify({ ...json, format: 'chamdo-entity-sketch' })), doc);
});

test('malformed imports reject duplicate names, bad cardinalities and dangling links', () => {
  assert.throws(() => fromJSON('{'));
  assert.throws(() => fromJSON('{}'));
  assert.throws(() => fromJSON(JSON.stringify({ entities: [{ name: 'A' }, { name: 'a' }] })));
  assert.throws(() => fromJSON(JSON.stringify({ entities: [{ name: 'A', properties: [{ name: 'a', type: 'Missing' }] }] })));
  assert.throws(() => fromJSON(JSON.stringify({ entities: [{ name: 'A', properties: [{ name: 'a', type: 'str', cardinality: 'bogus' }] }] })));
  assert.throws(() => fromJSON(JSON.stringify({ entities: [{ name: 'A', properties: [{ name: 'a' }, { name: 'A' }] }] })));
  assert.throws(() => fromJSON(JSON.stringify({ entities: [{ id: 'same', name: 'A' }, { id: 'same', name: 'B' }] })));
});

test('PlantUML exports primitive arrays and labelled 1:1 and 1:N associations', () => {
  let doc = addProperty(blank(), 'project', 'owners Person *').document;
  doc = addProperty(doc, 'project', 'address Address').document;
  doc = addProperty(doc, 'project', 'scores int *').document;
  const uml = toPlantUML(doc);
  assert.match(uml, /^@startuml/);
  assert.match(uml, /owners: Person\[\]/);
  assert.match(uml, /scores: int\[\]/);
  assert.match(uml, /Project "1" --> "\*" Person : owners/);
  assert.match(uml, /Project "1" --> "1" Address : address/);
  assert.match(uml, /@enduml$/);
});

test('arranging handles cycles and gives tall cards enough vertical space', () => {
  let doc = addProperty(blank(), 'project', 'others Project *').document;
  for (let i = 0; i < 30; i++) doc = addProperty(doc, 'project', `p${i} int`).document;
  doc.entities.push(...['A', 'B', 'C'].map(name => ({ id: name, name, x: 0, y: 0, properties: [] })));
  const arranged = autoLayout(doc);
  assert.equal(arranged.entities.length, 4);
  assert.ok(arranged.entities[3].y > arranged.entities[0].y + cardHeight(arranged.entities[0]));
});

test('overwriting a selected property renames it in place rather than adding another', () => {
  const original = addProperty(blank(), 'project', 'PropName');
  const updated = addProperty(original.document, 'project', 'NewProp', original.property.id);
  assert.equal(updated.document.entities[0].properties.length, 1);
  assert.equal(updated.property.name, 'NewProp');
  assert.equal(updated.property.id, original.property.id);
});

test('right follows the active class property and left retraces its parent', () => {
  const doc = sampleDocument();
  const [project, task, person, status] = doc.entities;
  const tasks = project.properties.find(p => p.type === 'Task');
  assert.equal(neighbourEntity(doc, project.id, 'right', tasks.id).id, task.id);
  const assignee = task.properties.find(p => p.type === 'Person');
  assert.equal(neighbourEntity(doc, task.id, 'right', assignee.id).id, person.id);
  assert.equal(neighbourEntity(doc, person.id, 'left', null, task.id).id, task.id);
  assert.equal(neighbourEntity(doc, status.id, 'left', null, task.id).id, task.id);
});

test('entity navigation prefers links, then the nearest entity in that direction', () => {
  const doc = { name: 'Test', entities: [
    { id: 'centre', name: 'Centre', x: 400, y: 200, properties: [] },
    { id: 'near', name: 'Near', x: 700, y: 200, properties: [] },
    { id: 'far', name: 'Far', x: 1200, y: 200, properties: [] },
  ] };
  assert.equal(neighbourEntity(doc, 'centre', 'right').id, 'near');
  assert.equal(neighbourEntity(doc, 'centre', 'left'), null);
  doc.entities[0].properties.push({ id: 'link', name: 'remote', type: 'Far', many: false });
  assert.equal(neighbourEntity(doc, 'centre', 'right').id, 'far');
  assert.equal(neighbourEntity(doc, 'far', 'left').id, 'centre');
  assert.equal(neighbourEntity(doc, 'missing', 'right'), null);
});

test('enum syntax creates a named enum linked to the property, with values instead of properties', () => {
  assert.deepEqual(parseProperty('status enum'), { name: 'status', type: 'enum', many: false });
  const result = addProperty(blank(), 'project', 'status enum');
  assert.equal(result.property.type, 'Status');
  assert.equal(result.created.name, 'Status');
  assert.equal(isEnum(result.created), true);
  assert.deepEqual(result.created.values, []);
  assert.deepEqual(result.created.properties, []);
  assert.equal(result.document.entities.some(e => e.name === 'enum'), false);
  let document = result.document;
  for (const value of ['draft', 'active', 'archived']) document = addEnumValue(document, result.created.id, value).document;
  assert.deepEqual(entityRows(document.entities[1]).map(v => v.name), ['draft', 'active', 'archived']);
  assert.deepEqual(document.entities[1].properties, []);
  assert.deepEqual(result.document.entities[1].values, []);
});

test('enum properties have separate definitions, while explicit named references can share one', () => {
  let result = addProperty(blank(), 'project', 'status enum');
  const firstEnum = result.created;
  let document = result.document;
  document.entities.push({ id: 'item', name: 'Item', x: 0, y: 0, properties: [] });
  result = addProperty(document, 'item', 'status enum');
  assert.equal(result.created.name, 'ItemStatus');
  assert.notEqual(result.created.id, firstEnum.id);
  result = addProperty(result.document, 'item', 'fallback Status');
  assert.equal(result.created, null);
  assert.equal(result.property.type, firstEnum.name);
  assert.equal(result.document.entities.filter(isEnum).length, 2);
  result = addProperty(result.document, 'item', 'states enum *');
  assert.equal(result.property.many, true);
  assert.equal(isEnum(result.created), true);
});

test('updating or renaming an enum property retains its enum and values', () => {
  const original = addProperty(blank(), 'project', 'status enum');
  const document = addEnumValue(original.document, original.created.id, 'draft').document;
  const updated = addProperty(document, 'project', 'status enum');
  assert.equal(updated.created, null);
  assert.equal(updated.property.id, original.property.id);
  assert.equal(updated.property.type, original.created.name);
  const renamed = addProperty(updated.document, 'project', 'phase enum', original.property.id);
  assert.equal(renamed.created, null);
  assert.equal(renamed.document.entities.length, 2);
  assert.deepEqual(renamed.document.entities[1].values.map(v => v.name), ['draft']);
});

test('enum generation avoids existing class names', () => {
  const document = blank();
  document.entities.push({ id: 'existing', name: 'Status', x: 0, y: 0, properties: [] });
  document.entities.push({ id: 'existing2', name: 'ProjectStatus', x: 0, y: 0, properties: [] });
  const result = addProperty(document, 'project', 'status enum');
  assert.equal(result.created.name, 'ProjectStatus2');
  assert.equal(result.property.type, result.created.name);
  assert.equal(result.document.entities[1].kind, undefined);
});

test('enum values are untyped, editable in place and validated independently of property syntax', () => {
  const original = addProperty(blank(), 'project', 'status enum');
  const first = addEnumValue(original.document, original.created.id, 'draft');
  const updated = addEnumValue(first.document, original.created.id, 'active', first.property.id);
  assert.equal(updated.property.id, first.property.id);
  assert.equal(updated.document.entities[1].values.length, 1);
  const text = addEnumValue(updated.document, original.created.id, 'not draft');
  assert.equal(text.property.name, 'not draft');
  assert.equal(text.property.type, undefined);
  assert.throws(() => addEnumValue(text.document, original.created.id, 'not draft', first.property.id));
  assert.throws(() => addEnumValue(text.document, original.created.id, ''));
  assert.throws(() => addEnumValue(text.document, original.created.id, 'draft\narchived'));
  assert.throws(() => addProperty(text.document, original.created.id, 'count int'));
  assert.throws(() => addEnumValue(text.document, 'project', 'draft'));
});

test('JSON round trips enums, IDs, values and collections while still importing old sketches', () => {
  const result = addProperty(blank(), 'project', 'status enum *');
  const document = addEnumValue(result.document, result.created.id, 'draft').document;
  assert.deepEqual(fromJSON(toJSON(document)), document);
  const exported = JSON.parse(toJSON(document));
  assert.equal(exported.entities[1].kind, 'enum');
  assert.equal(exported.entities[1].properties, undefined);
  assert.equal(exported.entities[1].values[0].value, 'draft');
  assert.equal(exported.entities[0].properties[0].cardinality, 'many');
  assert.deepEqual(fromJSON(toJSON(sampleDocument())).entities.map(e => e.name), ['Project', 'Task', 'Person', 'Status']);
  const imported = fromJSON(JSON.stringify({ entities: [{ name: 'Status', kind: 'enum', values: ['draft', 'archived'] }] }));
  assert.deepEqual(imported.entities[0].values.map(v => v.name), ['draft', 'archived']);
});

test('enum imports reject mixed properties, duplicate values, bad kinds and invalid values', () => {
  const parse = entity => fromJSON(JSON.stringify({ entities: [entity] }));
  assert.throws(() => parse({ name: 'State', kind: 'enum', properties: [{ name: 'name' }] }));
  assert.throws(() => parse({ name: 'State', kind: 'enum', values: ['draft', 'DRAFT'] }));
  assert.throws(() => parse({ name: 'State', kind: 'enum', values: [null] }));
  assert.throws(() => parse({ name: 'State', kind: 'enum', values: [42] }));
  assert.throws(() => parse({ name: 'State', kind: 'enum', values: 'draft' }));
  assert.throws(() => parse({ name: 'State', kind: 'enum', values: ['a\nb'] }));
  assert.throws(() => parse({ name: 'State', kind: 'bogus', values: [] }));
  assert.throws(() => parse({ name: 'State', values: ['draft'] }));
});

test('enum renaming updates links and deletion removes the referring property', () => {
  const result = addProperty(blank(), 'project', 'status enum');
  let document = addEnumValue(result.document, result.created.id, 'draft').document;
  document = renameEntity(document, result.created.id, 'State');
  assert.equal(document.entities[0].properties[0].type, 'State');
  assert.deepEqual(document.entities[1].values.map(v => v.name), ['draft']);
  assert.equal(neighbourEntity(document, 'project', 'right', result.property.id).id, result.created.id);
  assert.equal(neighbourEntity(document, result.created.id, 'left').id, 'project');
  document = removeEntity(document, result.created.id);
  assert.equal(document.entities.length, 1);
  assert.deepEqual(document.entities[0].properties, []);
});

test('PlantUML exports enum declarations, values and dashed references', () => {
  const result = addProperty(blank(), 'project', 'status enum');
  let document = result.document;
  for (const value of ['draft', 'active', 'archived', 'not draft']) document = addEnumValue(document, result.created.id, value).document;
  const uml = toPlantUML(document);
  assert.match(uml, /enum Status \{\n  draft\n  active\n  archived\n  \{field\} "not draft"\n\}/);
  assert.match(uml, /status: Status/);
  assert.match(uml, /Project \.\.> Status : status/);
  assert.doesNotMatch(uml, /class Status|draft: str|class enum/);
  assert.equal(cardHeight(document.entities[1]), 52 + 4 * 30 + 32);
});
