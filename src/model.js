export const PRIMITIVES = ['str', 'int', 'float', 'bool', 'date', 'datetime', 'uuid', 'json'];
const ALIASES = { string: 'str', integer: 'int', number: 'float', boolean: 'bool' };
export const CARD_WIDTH = 248;
export const isEnum = (entity) => entity?.kind === 'enum';
export const entityRows = (entity) => (isEnum(entity) ? entity.values : entity?.properties) || [];
export const cardHeight = (entity) => 52 + Math.max(1, entityRows(entity).length) * 30 + 32;
export const uid = () => globalThis.crypto.randomUUID();
export const isPrimitive = (type) => PRIMITIVES.includes(type);
export const validName = (value) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(value);

export function neighbourEntity(document, entityId, direction, propertyId, returnToId) {
  const current = document.entities.find(e => e.id === entityId);
  if (!current) return null;
  const others = document.entities.filter(e => e.id !== entityId);
  const outgoing = others.filter(e => current.properties.some(p => p.type === e.name));
  const incoming = others.filter(e => e.properties.some(p => p.type === current.name));
  if (direction === 'right') {
    const type = current.properties.find(p => p.id === propertyId)?.type;
    const direct = outgoing.find(e => e.name === type);
    if (direct) return direct;
  } else {
    const previous = incoming.find(e => e.id === returnToId);
    if (previous) return previous;
  }
  const sign = direction === 'right' ? 1 : -1;
  const score = e => Math.hypot(e.x - current.x, (e.y - current.y) * 1.5);
  const rank = list => [...list].sort((a, b) => {
    const aAhead = (a.x - current.x) * sign > 0;
    const bAhead = (b.x - current.x) * sign > 0;
    return Number(bAhead) - Number(aAhead) || score(a) - score(b);
  });
  const linked = direction === 'right' ? outgoing : incoming;
  return rank(linked)[0] || rank(others.filter(e => (e.x - current.x) * sign > 0))[0] || null;
}

export function checkName(value) {
  const name = value.trim();
  if (!validName(name)) throw new Error('Use a name starting with a letter or _, then letters, numbers or _.');
  if (isPrimitive(name) || Object.hasOwn(ALIASES, name)) throw new Error('That name is reserved for a built-in type.');
  return name;
}

export function parseProperty(line) {
  const parts = line.trim().split(/\s+/);
  const name = parts.shift();
  if (!name || !validName(name)) throw new Error('Start with a property name, for example: count int');
  const many = parts.at(-1) === '*';
  if (many) parts.pop();
  if (parts.length > 1 || parts.includes('*')) throw new Error('Use: name [type] [*] — for example: items Item *');
  let type = parts[0] || 'str';
  type = Object.hasOwn(ALIASES, type) ? ALIASES[type] : type;
  if (!validName(type)) throw new Error('Use a built-in type or an entity name, followed by an optional *.');
  return { name, type, many };
}

export function nextPosition(entities, near) {
  if (near) {
    let x = near.x + CARD_WIDTH + 110;
    let y = near.y;
    while (entities.some(e => Math.abs(e.x - x) < CARD_WIDTH + 30 && Math.abs(e.y - y) < cardHeight(e) + 30)) y += 240;
    return { x, y };
  }
  const i = entities.length;
  return { x: 90 + (i % 3) * 350, y: 90 + Math.floor(i / 3) * 300 };
}

export function addProperty(document, entityId, line, propertyId) {
  const parsed = parseProperty(line);
  const next = structuredClone(document);
  const entity = next.entities.find(e => e.id === entityId);
  if (!entity) throw new Error('Select an entity first.');
  if (isEnum(entity)) throw new Error('Enums contain values, not properties.');
  const duplicate = entity.properties.find(p => p.name.toLowerCase() === parsed.name.toLowerCase() && p.id !== propertyId);
  if (duplicate && propertyId) throw new Error('This entity already has a property with that name.');
  const index = entity.properties.findIndex(p => p.id === (propertyId || duplicate?.id));
  let created = null;
  if (parsed.type === 'enum') {
    const previous = next.entities.find(e => e.name === entity.properties[index]?.type);
    if (isEnum(previous)) parsed.type = previous.name;
    else {
      const base = parsed.name.split('_').filter(Boolean).map(part => part[0].toUpperCase() + part.slice(1)).join('') || 'Values';
      const taken = name => next.entities.some(e => e.name.toLowerCase() === name.toLowerCase());
      let name = base;
      if (taken(name)) name = `${entity.name}${base}`;
      const scoped = name;
      for (let suffix = 2; taken(name); suffix++) name = `${scoped}${suffix}`;
      created = { id: uid(), name: checkName(name), kind: 'enum', ...nextPosition(next.entities, entity), properties: [], values: [] };
      next.entities.push(created);
      parsed.type = name;
    }
  }
  const existingType = next.entities.find(e => e.name.toLowerCase() === parsed.type.toLowerCase());
  if (existingType && !isPrimitive(parsed.type)) parsed.type = existingType.name;
  if (!isPrimitive(parsed.type) && !existingType) {
    created = { id: uid(), name: checkName(parsed.type), ...nextPosition(next.entities, entity), properties: [] };
    next.entities.push(created);
  }
  const property = { ...parsed, id: index >= 0 ? entity.properties[index].id : uid() };
  if (index >= 0) entity.properties[index] = property;
  else entity.properties.push(property);
  return { document: next, created, updated: index >= 0, property };
}

function checkEnumValue(value) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Enter an enum value.');
  if (/[\x00-\x1f\x7f]/.test(value)) throw new Error('Enter one enum value per line.');
  return value.trim();
}

export function addEnumValue(document, entityId, line, valueId) {
  const name = checkEnumValue(line);
  const next = structuredClone(document);
  const entity = next.entities.find(e => e.id === entityId);
  if (!isEnum(entity)) throw new Error('Select an enum to add values.');
  const duplicate = entity.values.find(v => v.name.toLowerCase() === name.toLowerCase() && v.id !== valueId);
  if (duplicate && valueId) throw new Error('This enum already has that value.');
  const index = entity.values.findIndex(v => v.id === (valueId || duplicate?.id));
  const value = { id: index >= 0 ? entity.values[index].id : uid(), name };
  if (index >= 0) entity.values[index] = value;
  else entity.values.push(value);
  return { document: next, created: null, updated: index >= 0, property: value };
}

export function renameEntity(document, entityId, value) {
  const name = checkName(value);
  if (document.entities.some(e => e.id !== entityId && e.name.toLowerCase() === name.toLowerCase())) throw new Error('An entity with that name already exists.');
  const oldName = document.entities.find(e => e.id === entityId)?.name;
  return { ...document, entities: document.entities.map(e => ({
    ...e, name: e.id === entityId ? name : e.name,
    properties: e.properties.map(p => ({ ...p, type: p.type === oldName ? name : p.type })),
  })) };
}

export function removeEntity(document, entityId) {
  const name = document.entities.find(e => e.id === entityId)?.name;
  return { ...document, entities: document.entities.filter(e => e.id !== entityId).map(e => ({
    ...e, properties: e.properties.filter(p => p.type !== name),
  })) };
}

export function toJSON(document) {
  return JSON.stringify({
    format: 'entity-sketch', version: 1, name: document.name,
    entities: document.entities.map(e => ({
      id: e.id, name: e.name, position: { x: e.x, y: e.y },
      ...(isEnum(e)
        ? { kind: 'enum', values: e.values.map(v => ({ id: v.id, value: v.name })) }
        : { properties: e.properties.map(p => ({ id: p.id, name: p.name, type: p.type, cardinality: p.many ? 'many' : 'one' })) }),
    })),
  }, null, 2);
}

export function fromJSON(text) {
  const data = JSON.parse(text);
  if (!data || !Array.isArray(data.entities)) throw new Error('Expected a JSON object with an entities array.');
  if (data.version != null && data.version !== 1) throw new Error('This sketch version is not supported.');
  if (data.entities.length > 500) throw new Error('Import at most 500 entities in one sketch.');
  const names = new Set();
  const ids = new Set();
  const getId = (value) => {
    const id = typeof value === 'string' && value ? value : uid();
    if (ids.has(id)) throw new Error('The sketch contains duplicate IDs.');
    ids.add(id);
    return id;
  };
  const entities = data.entities.map((e, i) => {
    if (!e || typeof e.name !== 'string') throw new Error('Every entity needs a name.');
    const name = checkName(e.name);
    if (names.has(name.toLowerCase())) throw new Error(`Duplicate entity: ${name}`);
    names.add(name.toLowerCase());
    if (e.kind != null && !['entity', 'enum'].includes(e.kind)) throw new Error(`Invalid kind for ${name}.`);
    if (e.properties != null && !Array.isArray(e.properties)) throw new Error(`Invalid properties for ${name}.`);
    if (e.kind === 'enum') {
      if (e.properties?.length) throw new Error(`Enum ${name} contains values, not properties.`);
      if (e.values != null && !Array.isArray(e.values)) throw new Error(`Invalid values for ${name}.`);
      if ((e.values?.length || 0) > 500) throw new Error('Import at most 500 values per enum.');
      const valueNames = new Set();
      return {
        id: getId(e.id), name, kind: 'enum', properties: [],
        x: Number.isFinite(e.position?.x) ? e.position.x : 90 + (i % 3) * 350,
        y: Number.isFinite(e.position?.y) ? e.position.y : 90 + Math.floor(i / 3) * 300,
        values: (e.values || []).map(v => {
          const value = checkEnumValue(typeof v === 'string' ? v : v?.value ?? v?.name);
          if (valueNames.has(value.toLowerCase())) throw new Error(`Duplicate value in ${name}: ${value}`);
          valueNames.add(value.toLowerCase());
          return { id: getId(typeof v === 'string' ? undefined : v.id), name: value };
        }),
      };
    }
    if (e.values != null) throw new Error(`Set kind to enum to import values for ${name}.`);
    if ((e.properties?.length || 0) > 500) throw new Error('Import at most 500 properties per entity.');
    const propertyNames = new Set();
    return {
      id: getId(e.id), name,
      x: Number.isFinite(e.position?.x) ? e.position.x : 90 + (i % 3) * 350,
      y: Number.isFinite(e.position?.y) ? e.position.y : 90 + Math.floor(i / 3) * 300,
      properties: (e.properties || []).map(p => {
        if (!p || typeof p.name !== 'string' || !validName(p.name)) throw new Error(`Invalid property in ${name}.`);
        if (propertyNames.has(p.name.toLowerCase())) throw new Error(`Duplicate property: ${name}.${p.name}`);
        propertyNames.add(p.name.toLowerCase());
        if (p.cardinality != null && !['one', 'many'].includes(p.cardinality)) throw new Error(`Invalid cardinality for ${name}.${p.name}.`);
        const type = p.type || 'str';
        if (typeof type !== 'string' || !validName(type)) throw new Error(`Invalid type for ${name}.${p.name}.`);
        return { id: getId(p.id), name: p.name, type: Object.hasOwn(ALIASES, type) ? ALIASES[type] : type, many: p.cardinality === 'many' || p.many === true };
      }),
    };
  });
  for (const entity of entities) {
    for (const p of entity.properties) {
      if (!isPrimitive(p.type)) {
        const target = entities.find(e => e.name.toLowerCase() === p.type.toLowerCase());
        if (!target) throw new Error(`Missing entity ${p.type}, referenced by ${entity.name}.${p.name}.`);
        p.type = target.name;
      }
    }
  }
  return { name: typeof data.name === 'string' ? data.name : 'Untitled sketch', entities };
}

export function toPlantUML(document) {
  const lines = ['@startuml', 'hide methods', 'skinparam classAttributeIconSize 0', ''];
  document.entities.forEach(e => {
    lines.push(`${isEnum(e) ? 'enum' : 'class'} ${e.name} {`);
    if (isEnum(e)) e.values.forEach(v => lines.push(`  ${validName(v.name) ? v.name : `{field} ${JSON.stringify(v.name)}`}`));
    else e.properties.forEach(p => lines.push(`  ${p.name}: ${p.type}${p.many ? '[]' : ''}`));
    lines.push('}', '');
  });
  document.entities.forEach(e => e.properties.filter(p => !isPrimitive(p.type)).forEach(p => {
    const target = document.entities.find(t => t.name === p.type);
    lines.push(isEnum(target)
      ? `${e.name} ..> ${p.type} : ${p.name}${p.many ? '[]' : ''}`
      : `${e.name} "1" --> "${p.many ? '*' : '1'}" ${p.type} : ${p.name}`);
  }));
  lines.push('', '@enduml');
  return lines.join('\n');
}

export function autoLayout(document) {
  // Place connected entities together, with enough space for the tallest card in each row.
  const remaining = new Set(document.entities.map(e => e.id));
  const ordered = [];
  const visit = (e) => {
    if (!remaining.delete(e.id)) return;
    ordered.push(e);
    e.properties.forEach(p => {
      const target = document.entities.find(x => x.name === p.type);
      if (target) visit(target);
    });
  };
  document.entities.forEach(visit);
  let y = 90;
  const entities = [];
  for (let i = 0; i < ordered.length; i += 3) {
    const row = ordered.slice(i, i + 3);
    row.forEach((e, j) => entities.push({ ...e, x: 90 + j * 360, y }));
    y += Math.max(...row.map(cardHeight)) + 120;
  }
  return { ...document, entities };
}

export function sampleDocument() {
  const property = (name, type = 'str', many = false) => ({ id: uid(), name, type, many });
  return { name: 'Project model', entities: [
    { id: uid(), name: 'Project', x: 60, y: 170, properties: [property('name'), property('created', 'date'), property('tasks', 'Task', true), property('members', 'Person', true)] },
    { id: uid(), name: 'Task', x: 450, y: 75, properties: [property('title'), property('estimate', 'int'), property('assignee', 'Person'), property('status', 'Status')] },
    { id: uid(), name: 'Person', x: 840, y: 40, properties: [property('name'), property('email')] },
    { id: uid(), name: 'Status', kind: 'enum', x: 840, y: 320, properties: [], values: ['todo', 'in_progress', 'done'].map(name => ({ id: uid(), name })) },
  ] };
}

export function fuzzyMatch(query, name) {
  let i = 0;
  const q = query.toLowerCase();
  for (const c of name.toLowerCase()) if (q[i] === c) i++;
  return i === q.length;
}
