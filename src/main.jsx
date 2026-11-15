import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Box, List, Plus, Search, Upload, Download, ArrowUpRight, ArrowRight, X, Trash2, Pencil, Check, Keyboard, Maximize, Minus, Undo2, Redo2, LayoutGrid, ChevronRight, Copy, FileJson, Braces, MousePointer2, PanelRightClose, PanelRightOpen, RotateCcw } from 'lucide-react';
import { PRIMITIVES, CARD_WIDTH, cardHeight, uid, isPrimitive, isEnum, entityRows, checkName, parseProperty, addProperty, addEnumValue, renameEntity, removeEntity, toJSON, fromJSON, toPlantUML, autoLayout, sampleDocument, nextPosition, fuzzyMatch, neighbourEntity } from './model.js';
import './style.css';

const STORAGE_KEY = 'chamdo-entity-sketch-v1';
const colours = ['green', 'blue', 'amber', 'violet', 'rose'];
const shortcuts = [
  ['n', 'New entity'], ['j', 'Jump to entity'], ['p', 'Add property / value'], ['r', 'Rename entity'],
  ['x', 'Export sketch'], ['f', 'Fit graph'], ['a', 'Arrange graph'], ['u', 'Undo'], ['y', 'Redo'], ['h', 'Keyboard help'],
];
const getInitial = () => {
  try { const saved = localStorage.getItem(STORAGE_KEY); return { document: saved ? fromJSON(saved) : sampleDocument(), error: false }; }
  catch { return { document: { name: 'Recovered sketch', entities: [] }, error: true }; }
};
const initial = getInitial();
const isEditing = (target) => target instanceof HTMLElement && (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable);
const propertyLine = p => `${p.name}${p.type && p.type !== 'str' ? ` ${p.type}` : ''}${p.many ? ' *' : ''}`;

function App() {
  const [document, setDocument] = useState(initial.document);
  const [selectedId, setSelectedId] = useState(initial.document.entities[0]?.id || null);
  const [history, setHistory] = useState({ past: [], future: [] });
  const [modal, setModal] = useState(null);
  const [leader, setLeader] = useState(false);
  const [query, setQuery] = useState('');
  const [jumpIndex, setJumpIndex] = useState(0);
  const [nameDraft, setNameDraft] = useState('');
  const [draft, setDraft] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [propertyEditorOpen, setPropertyEditorOpen] = useState(false);
  const [editorSurface, setEditorSurface] = useState('graph');
  const [focusRequest, setFocusRequest] = useState(0);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [saved, setSaved] = useState(true);
  const [storageProblem, setStorageProblem] = useState(initial.error ? 'Saved sketch could not be read. Export or clear storage before editing.' : '');
  const [exportFormat, setExportFormat] = useState('json');
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [focusedInput, setFocusedInput] = useState(false);
  const [view, setView] = useState({ x: 40, y: 50, scale: 0.8 });
  const [dragging, setDragging] = useState(false);
  const canvasRef = useRef(null);
  const propertyRef = useRef(null);
  const inspectorPropertyRef = useRef(null);
  const modalInputRef = useRef(null);
  const fileRef = useRef(null);
  const dragRef = useRef(null);
  const documentRef = useRef(document);
  const focusAfterSelect = useRef(null);
  const propertyCursors = useRef(new Map());
  const returnParents = useRef(new Map());
  documentRef.current = document;
  const selected = document.entities.find(e => e.id === selectedId);
  const selectedEnum = isEnum(selected);
  const relationships = document.entities.flatMap(e => e.properties.filter(p => !isPrimitive(p.type)).map(p => ({ source: e, target: document.entities.find(t => t.name === p.type), property: p }))).filter(r => r.target);
  const selectedColour = colours[Math.max(0, document.entities.findIndex(e => e.id === selectedId)) % colours.length];
  const filtered = document.entities.filter(e => fuzzyMatch(query, e.name));
  const exports = exportFormat === 'json' ? toJSON(document) : toPlantUML(document);
  const references = selected ? document.entities.flatMap(e => e.properties.filter(p => p.type === selected.name).map(p => `${e.name}.${p.name}`)) : [];

  function flash(message) { setNotice(message); }
  function commit(next, message) {
    setHistory(h => ({ past: [...h.past.slice(-79), documentRef.current], future: [] }));
    setDocument(next);
    if (message) flash(message);
  }
  function undo() {
    if (!history.past.length) return;
    const previous = history.past.at(-1);
    setHistory({ past: history.past.slice(0, -1), future: [document, ...history.future] });
    setDocument(previous); setDraft(''); setEditingId(null); flash('Undone');
  }
  function redo() {
    if (!history.future.length) return;
    setHistory({ past: [...history.past, document], future: history.future.slice(1) });
    setDocument(history.future[0]); setDraft(''); setEditingId(null); flash('Redone');
  }
  function requestPropertyFocus(surface = 'graph', overwrite = false) {
    setPropertyEditorOpen(true); setEditorSurface(surface);
    focusAfterSelect.current = { surface, overwrite };
    setFocusRequest(n => n + 1);
  }
  function select(id, focus = false) {
    setSelectedId(id); setDraft(''); setEditingId(null); setError('');
    setPropertyEditorOpen(focus);
    if (focus) { propertyCursors.current.set(id, null); requestPropertyFocus(); }
  }
  function fit(entities = documentRef.current.entities) {
    const bounds = canvasRef.current?.getBoundingClientRect();
    if (!bounds || !entities.length) { setView({ x: 60, y: 80, scale: 1 }); return; }
    const left = Math.min(...entities.map(e => e.x));
    const right = Math.max(...entities.map(e => e.x + CARD_WIDTH));
    const top = Math.min(...entities.map(e => e.y));
    const bottom = Math.max(...entities.map(e => e.y + cardHeight(e)));
    const scale = Math.max(0.18, Math.min(1, (bounds.width - 110) / (right - left), (bounds.height - 150) / (bottom - top)));
    setView({ x: (bounds.width - (right - left) * scale) / 2 - left * scale, y: (bounds.height - (bottom - top) * scale) / 2 - top * scale, scale });
  }
  function centreOn(entity, editing = false) {
    const bounds = canvasRef.current?.getBoundingClientRect();
    if (bounds) setView(v => {
      const scale = editing ? Math.max(v.scale, 1) : v.scale;
      return { scale, x: bounds.width / 2 - (entity.x + CARD_WIDTH / 2) * scale, y: bounds.height / 2 - (entity.y + cardHeight(entity) / 2) * scale };
    });
  }
  function openModal(type) {
    setLeader(false); setError(''); setQuery(''); setJumpIndex(0);
    setNameDraft(type === 'rename' ? selected?.name || '' : '');
    setModal(type);
  }
  function focusProperty() {
    if (!selected) { openModal('new'); return; }
    setEditingId(null); setDraft(''); setError('');
    propertyCursors.current.set(selectedId, null);
    requestPropertyFocus(); centreOn(selected, true);
  }
  function arrange() {
    const next = autoLayout(document);
    commit(next, 'Graph arranged'); fit(next.entities);
  }
  function submitName(event) {
    event.preventDefault();
    try {
      const name = checkName(nameDraft);
      if (modal === 'rename') {
        commit(renameEntity(document, selectedId, name), `Renamed to ${name}`); setModal(null); return;
      }
      const existing = document.entities.find(e => e.name.toLowerCase() === name.toLowerCase());
      if (existing) { select(existing.id, true); centreOn(existing, true); setModal(null); flash(`Jumped to existing entity ${existing.name}`); return; }
      const entity = { id: uid(), name, ...nextPosition(document.entities), properties: [] };
      commit({ ...document, entities: [...document.entities, entity] }, `Created ${name}`);
      select(entity.id, true); setModal(null); centreOn(entity, true);
    } catch (e) { setError(e.message); }
  }
  function submitProperty(event) {
    event.preventDefault();
    if (!draft.trim()) return;
    if (!savePropertyDraft()) return;
    setDraft(''); setEditingId(null); setError('');
    propertyCursors.current.set(selectedId, null);
    requestPropertyFocus(editorSurface);
  }
  function savePropertyDraft() {
    if (!draft.trim()) return { document, property: entityRows(selected).find(p => p.id === editingId) };
    const existing = entityRows(selected).find(p => p.id === editingId);
    if (existing && propertyLine(existing) === draft.trim()) return { document, property: existing };
    try {
      const result = (selectedEnum ? addEnumValue : addProperty)(document, selectedId, draft, editingId);
      commit(result.document, `${result.updated ? 'Updated' : 'Added'} ${result.property.name}${result.created ? ` · created ${isEnum(result.created) ? 'enum ' : ''}${result.created.name}` : ''}`);
      setError(''); return result;
    } catch (e) { setError(e.message); return null; }
  }
  function editProperty(property, surface = 'graph', entityId = selectedId) {
    setDraft(propertyLine(property)); setEditingId(property.id); setError('');
    propertyCursors.current.set(entityId, property.id);
    requestPropertyFocus(surface, true);
  }
  function moveProperty(delta, surface = editorSurface) {
    const result = savePropertyDraft();
    if (!result) return;
    const entity = result.document.entities.find(e => e.id === selectedId);
    if (!entity) return;
    if (!propertyEditorOpen && surface === 'graph') centreOn(entity, true);
    const activeId = result.property?.id || editingId;
    const index = activeId ? entityRows(entity).findIndex(p => p.id === activeId) : entityRows(entity).length;
    const nextIndex = Math.max(0, Math.min(entityRows(entity).length, index + delta));
    const property = entityRows(entity)[nextIndex];
    if (property) editProperty(property, surface);
    else {
      setDraft(''); setEditingId(null); setError('');
      propertyCursors.current.set(selectedId, null); requestPropertyFocus(surface);
    }
  }
  function moveEntity(direction, surface = editorSurface) {
    const result = savePropertyDraft();
    if (!result) return;
    const entity = result.document.entities.find(e => e.id === selectedId);
    const activeId = result.property?.id || editingId || entityRows(entity).at(-1)?.id;
    const target = neighbourEntity(result.document, selectedId, direction, activeId, returnParents.current.get(selectedId));
    if (!target) {
      if (result.property) editProperty(result.property, surface);
      flash(`No entity to the ${direction}`); return;
    }
    propertyCursors.current.set(selectedId, result.property?.id || editingId);
    if (direction === 'right') returnParents.current.set(target.id, selectedId);
    setSelectedId(target.id); setError(''); centreOn(target, true);
    const cursor = propertyCursors.current.get(target.id);
    const property = propertyCursors.current.has(target.id) ? entityRows(target).find(p => p.id === cursor) : entityRows(target)[0];
    if (property) editProperty(property, surface, target.id);
    else { setDraft(''); setEditingId(null); requestPropertyFocus(surface); }
  }
  function propertyKeydown(event, surface) {
    if (event.nativeEvent.isComposing || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
    if (event.key === 'Tab' && suggestions.length) { event.preventDefault(); completeType(suggestions[0], surface); return; }
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') moveProperty(event.key === 'ArrowUp' ? -1 : 1, surface);
    else moveEntity(event.key === 'ArrowLeft' ? 'left' : 'right', surface);
  }
  function deleteProperty(id) {
    const field = selectedEnum ? 'values' : 'properties';
    commit({ ...document, entities: document.entities.map(e => e.id === selectedId ? { ...e, [field]: e[field].filter(p => p.id !== id) } : e) }, selectedEnum ? 'Value removed' : 'Property removed');
    if (editingId === id) { setDraft(''); setEditingId(null); propertyCursors.current.set(selectedId, null); requestPropertyFocus(editorSurface); }
  }
  function download(content, extension) {
    const url = URL.createObjectURL(new Blob([content], { type: extension === 'json' ? 'application/json' : 'text/plain' }));
    const link = window.document.createElement('a'); link.href = url;
    link.download = `${document.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'entities'}.${extension}`;
    link.click(); setTimeout(() => URL.revokeObjectURL(url), 500); flash(`Exported ${extension.toUpperCase()}`);
  }
  async function importFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      if (file.size > 2_000_000) throw new Error('Choose a JSON file smaller than 2 MB.');
      const next = fromJSON(await file.text());
      commit(next, `Imported ${next.entities.length} types · undo to restore the previous sketch`);
      select(next.entities[0]?.id || null); fit(next.entities);
      setStorageProblem('');
    } catch (e) { setError(e.message); setModal('import-error'); }
    event.target.value = '';
  }
  async function copyExport() {
    try { await navigator.clipboard.writeText(exports); flash('Copied to clipboard'); }
    catch { flash('Clipboard unavailable here. Select the preview text or download the file.'); }
  }
  function zoom(factor, anchor) {
    const bounds = canvasRef.current?.getBoundingClientRect();
    if (!bounds) return;
    const p = anchor || { x: bounds.width / 2, y: bounds.height / 2 };
    setView(v => {
      const scale = Math.min(1.8, Math.max(0.18, v.scale * factor));
      return { x: p.x - (p.x - v.x) * scale / v.scale, y: p.y - (p.y - v.y) * scale / v.scale, scale };
    });
  }
  function startDrag(event, entity) {
    if (event.button !== 0 || isEditing(event.target) || event.target.closest('button')) return;
    event.preventDefault();
    if (entity) select(entity.id);
    dragRef.current = { kind: entity ? 'node' : 'pan', entity, pointerX: event.clientX, pointerY: event.clientY, view, original: documentRef.current, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId); setDragging(true);
  }
  function moveDrag(event) {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = event.clientX - drag.pointerX, dy = event.clientY - drag.pointerY;
    if (Math.abs(dx) + Math.abs(dy) < 3 && !drag.moved) return;
    drag.moved = true;
    if (drag.kind === 'pan') setView({ ...drag.view, x: drag.view.x + dx, y: drag.view.y + dy });
    else setDocument({ ...drag.original, entities: drag.original.entities.map(e => e.id === drag.entity.id ? { ...e, x: drag.entity.x + dx / drag.view.scale, y: drag.entity.y + dy / drag.view.scale } : e) });
  }
  function endDrag() {
    const drag = dragRef.current;
    if (drag?.kind === 'node' && drag.moved) setHistory(h => ({ past: [...h.past.slice(-79), drag.original], future: [] }));
    dragRef.current = null; setDragging(false);
  }

  useEffect(() => {
    if (initial.error && storageProblem) return;
    setSaved(false);
    const timer = setTimeout(() => {
      try { localStorage.setItem(STORAGE_KEY, toJSON(document)); setSaved(true); setStorageProblem(''); }
      catch { setStorageProblem('Browser storage is unavailable or full. Export JSON to keep your sketch.'); }
    }, 350);
    return () => clearTimeout(timer);
  }, [document, storageProblem]);
  useEffect(() => { if (notice) { const t = setTimeout(() => setNotice(''), 3500); return () => clearTimeout(t); } }, [notice]);
  useEffect(() => { if (leader) { const t = setTimeout(() => setLeader(false), 2200); return () => clearTimeout(t); } }, [leader]);
  useEffect(() => {
    if (!selected && document.entities.length) setSelectedId(document.entities[0].id);
  }, [document.entities, selected]);
  useEffect(() => {
    const request = focusAfterSelect.current;
    if (!request || !selected || modal) return;
    const input = request.surface === 'inspector' && inspectorOpen ? inspectorPropertyRef.current : propertyRef.current;
    if (!input) return;
    input.focus();
    if (request.overwrite) input.select();
    const row = propertyRef.current?.getBoundingClientRect();
    const bounds = canvasRef.current?.getBoundingClientRect();
    if (row && bounds) {
      const dx = row.left < bounds.left + 24 ? bounds.left + 24 - row.left : Math.min(0, bounds.right - 24 - row.right);
      const dy = row.top < bounds.top + 100 ? bounds.top + 100 - row.top : Math.min(0, bounds.bottom - 80 - row.bottom);
      if (dx || dy) setView(v => ({ ...v, x: v.x + dx, y: v.y + dy }));
    }
    focusAfterSelect.current = null;
  }, [selectedId, editingId, inspectorOpen, propertyEditorOpen, modal, focusRequest]);
  useEffect(() => { if (modal) requestAnimationFrame(() => { modalInputRef.current?.focus(); if (modal === 'rename') modalInputRef.current?.select(); }); }, [modal]);
  useLayoutEffect(() => {
    const observer = new ResizeObserver(() => { if (!dragRef.current) fit(); });
    if (canvasRef.current) observer.observe(canvasRef.current);
    return () => observer.disconnect();
  }, [inspectorOpen]);
  useEffect(() => {
    const canvas = canvasRef.current;
    function wheel(event) {
      event.preventDefault();
      const bounds = canvas.getBoundingClientRect();
      if (event.ctrlKey || event.metaKey) zoom(Math.exp(-event.deltaY * 0.007), { x: event.clientX - bounds.left, y: event.clientY - bounds.top });
      else if (event.shiftKey) setView(v => ({ ...v, x: v.x - event.deltaY, y: v.y - event.deltaX }));
      else zoom(Math.exp(-event.deltaY * 0.0015), { x: event.clientX - bounds.left, y: event.clientY - bounds.top });
    }
    canvas?.addEventListener('wheel', wheel, { passive: false });
    return () => canvas?.removeEventListener('wheel', wheel);
  }, []);
  useEffect(() => {
    function keydown(event) {
      if (event.key === 'Escape') {
        event.preventDefault(); setModal(null); setLeader(false); setError(''); setDraft(''); setEditingId(null);
        setPropertyEditorOpen(false);
        focusAfterSelect.current = null;
        if (isEditing(event.target)) event.target.blur();
        return;
      }
      if (modal || isEditing(event.target)) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? redo() : undo(); return; }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); openModal('jump'); return; }
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (!leader && !event.shiftKey && selected && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) {
        event.preventDefault();
        if (event.key === 'ArrowUp' || event.key === 'ArrowDown') moveProperty(event.key === 'ArrowUp' ? -1 : 1, 'graph');
        else moveEntity(event.key === 'ArrowLeft' ? 'left' : 'right', 'graph');
        return;
      }
      if (event.repeat) return;
      if (leader) {
        event.preventDefault(); setLeader(false);
        const commands = { n: () => openModal('new'), j: () => openModal('jump'), p: focusProperty, r: () => selected && openModal('rename'), x: () => openModal('export'), f: () => fit(), a: arrange, u: undo, y: redo, h: () => openModal('help'), '?': () => openModal('help') };
        commands[event.key.toLowerCase()]?.(); return;
      }
      if (event.code === 'Space') { event.preventDefault(); setLeader(true); }
      else if (event.key === '?') { event.preventDefault(); openModal('help'); }
      else if (event.key === 'Enter' && selected) { event.preventDefault(); focusProperty(); }
      else if ((event.key === 'Delete' || event.key === 'Backspace') && selected) { event.preventDefault(); openModal('delete'); }
    }
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  });
  // Keep keyboard focus inside dialogs; Escape is handled globally.
  useEffect(() => {
    if (!modal) return;
    const previous = window.document.activeElement;
    const onKey = event => {
      if (event.key !== 'Tab') return;
      const items = [...window.document.querySelectorAll('[role="dialog"] button, [role="dialog"] input, [role="dialog"] textarea')].filter(el => !el.disabled);
      const first = items[0], last = items.at(-1);
      if (event.shiftKey && window.document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && window.document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, [modal]);

  let draftPreview = null;
  try { if (draft.trim() && !selectedEnum) draftPreview = parseProperty(draft); } catch {}
  const words = draft.trimStart().split(/\s+/);
  const typePrefix = words.length === 2 ? words[1] : null;
  const suggestions = !selectedEnum && typePrefix != null ? [...PRIMITIVES, 'enum', ...document.entities.map(e => e.name)].filter(t => t.toLowerCase().startsWith(typePrefix.toLowerCase())).slice(0, 5) : [];
  function completeType(type, surface = editorSurface) { setDraft(`${words[0]} ${type} `); requestPropertyFocus(surface); }

  function inlineEditor(entity, isNew = false) {
    const rowType = isEnum(entity) ? 'value' : 'property';
    return <form key={isNew ? 'new-property' : editingId} className={`card-edit-row ${isNew ? 'new-property-row' : ''} ${error && !modal ? 'invalid' : ''}`} onSubmit={submitProperty} onDoubleClick={event => event.stopPropagation()} aria-label={isNew ? `New ${rowType} row` : `Editing ${rowType} row`}>
      <span className="row-cursor" aria-hidden="true">{isNew ? '+' : '›'}</span>
      <input ref={propertyRef} aria-label={`${entity.name} ${rowType} editor`} value={draft} onChange={event => { setDraft(event.target.value); setError(''); }} onFocus={() => setEditorSurface('graph')} onKeyDown={event => propertyKeydown(event, 'graph')} placeholder={isEnum(entity) ? 'Enum value' : 'propertyName type *'} autoComplete="off" spellCheck="false" />
      <button type="submit" disabled={!draft.trim()} aria-label={`Save ${rowType} and add another`} title={`Save and start a new ${rowType} (Enter)`}>↵</button>
    </form>;
  }

  return <div className="app" onFocusCapture={e => setFocusedInput(isEditing(e.target))} onBlurCapture={() => setFocusedInput(false)}>
    <header className="topbar">
      <a className="brand" href="#" onClick={e => { e.preventDefault(); fit(); }} aria-label="Entity, fit graph"><span className="brand-icon"><Box size={20} /></span><span>entity<span className="brand-period">.</span></span></a>
      <div className="header-divider" />
      <div className="project-name"><span className="eyebrow">CHAMDO / STATE SKETCH</span><input aria-label="Sketch name" value={document.name} onChange={e => setDocument({ ...document, name: e.target.value })} onFocus={e => { e.target.dataset.original = e.target.value; }} onBlur={e => { if (e.target.dataset.original !== document.name) setHistory(h => ({ past: [...h.past.slice(-79), { ...document, name: e.target.dataset.original }], future: [] })); }} onKeyDown={e => e.key === 'Enter' && e.currentTarget.blur()} /></div>
      <span className={`saved ${storageProblem ? 'warning' : ''}`} title={storageProblem || 'Saved in this browser. Export JSON for a portable backup.'}><span className="status-dot" />{storageProblem ? 'Not saved' : saved ? 'Saved locally' : 'Saving…'}</span>
      <div className="header-actions"><button className="button quiet new-sketch" onClick={() => openModal('clear')}><Plus size={15} />New sketch</button><button className="button quiet" onClick={() => fileRef.current?.click()}><Upload size={15} /><span>Import</span></button><button className="button primary" onClick={() => openModal('export')}><Download size={15} />Export<span className="button-shortcut">␣ X</span></button></div>
      <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={importFile} />
    </header>
    {storageProblem && <div className="storage-warning">{storageProblem}<button onClick={() => openModal('export')}>Export backup</button></div>}
    <main className={`workspace ${!inspectorOpen ? 'inspector-closed' : ''}`}>
      <aside className="sidebar">
        <div className="sidebar-heading"><span className="eyebrow">ENTITIES</span><span className="count">{document.entities.length.toString().padStart(2, '0')}</span></div>
        <button className="new-entity" onClick={() => openModal('new')}><Plus size={17} /><span>New entity</span><kbd>␣ N</kbd></button>
        <button className="jump-button" onClick={() => openModal('jump')}><Search size={14} /><span>Jump to entity…</span><kbd>␣ J</kbd></button>
        <div className="entity-list">{document.entities.map((e, i) => <button key={e.id} className={`entity-item ${selectedId === e.id ? 'active' : ''}`} onClick={() => { select(e.id); centreOn(e); }}>{isEnum(e) ? <List size={12} className="enum-list-icon" /> : <span className={`entity-dot ${colours[i % colours.length]}`} />}<span>{e.name}</span><span className="entity-count">{entityRows(e).length}</span>{selectedId === e.id && <ChevronRight size={13} />}</button>)}{!document.entities.length && <p className="empty-list">No entities</p>}</div>
        <div className="sidebar-bottom"><button className="keyboard-help" onClick={() => openModal('help')}><Keyboard size={16} />Keyboard shortcuts<kbd>?</kbd></button></div>
      </aside>
      <section className={`canvas ${dragging ? 'dragging' : ''}`} ref={canvasRef} aria-label="Entity relationship graph" onPointerDown={e => { if (!e.target.closest('.entity-card, button')) { if (isEditing(window.document.activeElement)) window.document.activeElement.blur(); startDrag(e); } }} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag}>
        <div className="canvas-heading"><span className="canvas-label"><span className="live-dot" />ENTITY MAP</span><span>{document.entities.length} entities<span className="separator">/</span>{relationships.length} connections</span></div>
        {selected && propertyEditorOpen && <div className="canvas-edit-status"><span className="edit-status-dot" /><strong>{selected.name}{editingId ? `.${entityRows(selected).find(p => p.id === editingId)?.name || ''}` : ` · new ${selectedEnum ? 'value' : 'property'}`}</strong><span>Enter save + new · ↑↓ {selectedEnum ? 'values' : 'properties'} · ←→ entities</span></div>}
        <div className="graph-world" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}>
          <svg className="edges" aria-hidden="true"><defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 1 1 L 9 5 L 1 9" fill="none" stroke="context-stroke" strokeWidth="1.4" /></marker></defs>{relationships.map(({ source, target, property }) => {
            const index = source.properties.findIndex(p => p.id === property.id);
            const self = source.id === target.id;
            const right = target.x >= source.x + CARD_WIDTH / 2;
            const sx = source.x + (right || self ? CARD_WIDTH : 0), sy = source.y + 52 + index * 30 + 15;
            const tx = self ? sx : target.x + (right ? 0 : CARD_WIDTH), ty = self ? target.y + 25 : target.y + 26;
            const bend = Math.max(65, Math.abs(tx - sx) * 0.48);
            const path = self ? `M ${sx} ${sy} C ${sx + 95} ${sy}, ${tx + 95} ${ty}, ${tx} ${ty}` : `M ${sx} ${sy} C ${sx + (right ? bend : -bend)} ${sy}, ${tx + (right ? -bend : bend)} ${ty}, ${tx} ${ty}`;
            const active = source.id === selectedId || target.id === selectedId;
            return <g key={property.id} className={`edge ${active ? 'active' : ''} ${isEnum(target) ? 'enum-edge' : ''} ${propertyEditorOpen && source.id === selectedId && property.id === editingId ? 'editing-edge' : ''}`}><path d={path} markerEnd="url(#arrow)" /><circle cx={sx} cy={sy} r="3.5" /><rect x={self ? sx + 64 : (sx + tx) / 2 - 19} y={self ? (sy + ty) / 2 - 10 : (sy + ty) / 2 - 10} width="38" height="20" rx="6" /><text x={self ? sx + 83 : (sx + tx) / 2} y={(sy + ty) / 2 + 4}>{isEnum(target) ? `enum${property.many ? '[]' : ''}` : property.many ? '1 : N' : '1 : 1'}</text></g>;
          })}</svg>
          {document.entities.map((e, i) => <article key={e.id} className={`entity-card ${isEnum(e) ? 'enum-card' : colours[i % colours.length]} ${selectedId === e.id ? 'selected' : ''} ${selectedId === e.id && propertyEditorOpen ? 'editing' : ''}`} style={{ left: e.x, top: e.y, width: CARD_WIDTH }} aria-label={`${e.name} ${isEnum(e) ? 'enum' : 'entity'}`} onPointerDown={event => { event.stopPropagation(); startDrag(event, e); }} onDoubleClick={event => { if (!event.target.closest('input, button, form')) { select(e.id, true); centreOn(e, true); } }}>
            <div className="card-heading"><span className="card-icon">{isEnum(e) ? <List size={15} /> : <Box size={15} />}</span><strong>{e.name}</strong>{selectedId === e.id ? <span className="selected-tag">{isEnum(e) ? propertyEditorOpen ? 'EDIT ENUM' : 'ENUM' : propertyEditorOpen ? 'EDITING' : 'SELECTED'}</span> : <span className="class-tag">{isEnum(e) ? 'ENUM' : 'ENTITY'}</span>}</div>
            <div className="card-properties">{entityRows(e).length ? entityRows(e).map(p => selectedId === e.id && propertyEditorOpen && editingId === p.id ? inlineEditor(e) : <button key={p.id} className={`card-property ${isEnum(e) ? 'enum-value' : ''}`} onClick={() => { select(e.id); editProperty(p, 'graph', e.id); centreOn(e, true); }} title={`Edit ${p.name}`}><span>{p.name}</span>{!isEnum(e) && <span className={`property-type ${!isPrimitive(p.type) ? 'reference' : ''} ${isEnum(document.entities.find(t => t.name === p.type)) ? 'enum-reference' : ''}`}>{p.type}{p.many && <span className="many-mark">[]</span>}{!isPrimitive(p.type) && (isEnum(document.entities.find(t => t.name === p.type)) ? <List size={11} /> : <ArrowUpRight size={11} />)}</span>}</button>) : <div className="card-empty">No {isEnum(e) ? 'values' : 'properties'}</div>}</div>
            {selectedId === e.id && propertyEditorOpen && !editingId ? inlineEditor(e, true) : <button className="card-add" onClick={() => { select(e.id, true); centreOn(e, true); }}><Plus size={12} />Add {isEnum(e) ? 'value' : 'property'}<span>↵</span></button>}
            {selectedId === e.id && propertyEditorOpen && error && !modal && <div className="card-editor-error" role="alert">{error}</div>}
          </article>)}
        </div>
        {!document.entities.length && <div className="empty-canvas"><span className="empty-icon"><Box size={32} strokeWidth={1.2} /></span><h1>No entities</h1><button className="button primary" onClick={() => openModal('new')}><Plus size={16} />New entity<kbd>␣ N</kbd></button></div>}
        <div className="canvas-bottom"><div className="canvas-tip"><MousePointer2 size={13} />Drag to arrange<span>·</span>Scroll to zoom</div><div className="canvas-tools"><button title="Undo (Space U)" aria-label="Undo" onClick={undo} disabled={!history.past.length}><Undo2 size={16} /></button><button title="Redo (Space Y)" aria-label="Redo" onClick={redo} disabled={!history.future.length}><Redo2 size={16} /></button><span className="tool-divider" /><button title="Arrange graph (Space A)" aria-label="Arrange graph" onClick={arrange}><LayoutGrid size={15} /></button><button title="Fit graph (Space F)" aria-label="Fit graph" onClick={() => fit()}><Maximize size={15} /></button><span className="tool-divider" /><button aria-label="Zoom out" onClick={() => zoom(1 / 1.15)}><Minus size={15} /></button><span className="zoom-value">{Math.round(view.scale * 100)}%</span><button aria-label="Zoom in" onClick={() => zoom(1.15)}><Plus size={15} /></button><span className="tool-divider" /><button aria-label={inspectorOpen ? 'Hide inspector' : 'Show inspector'} onClick={() => setInspectorOpen(!inspectorOpen)}>{inspectorOpen ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}</button></div></div>
      </section>
      {inspectorOpen && <aside className="inspector">
        <div className="inspector-label"><span className="eyebrow">INSPECTOR</span><span className="subtle-label">{selected ? 'Selected entity' : 'Nothing selected'}</span></div>
        {selected ? <><div className="inspector-title"><span className={`inspector-icon ${selectedEnum ? 'enum-tone' : selectedColour}`}>{selectedEnum ? <List size={22} /> : <Box size={22} />}</span><div><span className="eyebrow">{selectedEnum ? 'ENUM' : 'ENTITY'}</span><button className="rename-entity" title="Rename (Space R)" onClick={() => openModal('rename')}>{selected.name}<Pencil size={13} /></button></div><button className="icon-button delete-entity" title="Delete" aria-label={selectedEnum ? 'Delete enum' : 'Delete entity'} onClick={() => openModal('delete')}><Trash2 size={15} /></button></div>
          <div className="section-label"><span>{selectedEnum ? 'Values' : 'Properties'}</span><span className="count">{entityRows(selected).length}</span></div>
          <div className="inspector-properties">{entityRows(selected).map(p => <div key={p.id} className={`inspector-property ${editingId === p.id ? 'is-editing' : ''}`}><button className="inspector-property-name" onClick={() => editProperty(p, 'inspector')}><span>{p.name}</span>{!selectedEnum && <small className={!isPrimitive(p.type) ? 'reference' : ''}>{p.type}{p.many ? '[]' : ''}</small>}</button>{!selectedEnum && !isPrimitive(p.type) && <button className="icon-button follow-reference" aria-label={`Jump to ${p.type}`} onClick={() => { const target = document.entities.find(e => e.name === p.type); if (target) { select(target.id); centreOn(target); } }}><ArrowUpRight size={13} /></button>}<button className="icon-button remove-property" aria-label={`Remove ${p.name}`} onClick={() => deleteProperty(p.id)}><X size={13} /></button></div>)}{!entityRows(selected).length && <p className="no-properties">No {selectedEnum ? 'values' : 'properties'}</p>}</div>
          <form className={`property-form ${error && !modal ? 'has-error' : ''}`} onSubmit={submitProperty}><label htmlFor="property-input">{editingId ? selectedEnum ? 'OVERWRITE VALUE' : 'OVERWRITE PROPERTY' : selectedEnum ? 'ADD A VALUE' : 'ADD A PROPERTY'}<kbd>↵</kbd></label><div className="property-input-wrap"><span className="input-prompt">{editingId ? '›' : '+'}</span><input id="property-input" ref={inspectorPropertyRef} value={draft} onFocus={() => { setPropertyEditorOpen(true); setEditorSurface('inspector'); }} onChange={e => { setDraft(e.target.value); setError(''); }} placeholder={selectedEnum ? 'Enum value' : 'propertyName type *'} autoComplete="off" spellCheck="false" onKeyDown={e => propertyKeydown(e, 'inspector')} /><button aria-label={editingId ? selectedEnum ? 'Save value' : 'Save property' : selectedEnum ? 'Add value' : 'Add property'} type="submit" disabled={!draft.trim()}><ArrowRight size={16} /></button></div>
            {suggestions.length > 0 && <div className="suggestions">{suggestions.map(type => <button key={type} type="button" onClick={() => completeType(type)}>{type}</button>)}<span>Tab ↹</span></div>}
            {error && !modal ? <p className="error" role="alert">{error}</p> : draftPreview ? <p className="draft-preview">{draftPreview.name}<ArrowRight size={10} />{draftPreview.type}{draftPreview.many ? '[] · one to many' : ' · one to one'}{draftPreview.type === 'enum' ? ' · enum values' : !isPrimitive(draftPreview.type) && !document.entities.some(e => e.name.toLowerCase() === draftPreview.type.toLowerCase()) && ' · new entity'}</p> : <p className="input-hint">Enter save + new · ↑↓ {selectedEnum ? 'values' : 'properties'} · ←→ entities</p>}
            {editingId && <button type="button" className="cancel-edit" onClick={() => { setEditingId(null); setDraft(''); setError(''); }}>Cancel edit</button>}
          </form>
          {selectedEnum ? <div className="syntax-guide"><div className="eyebrow">ENUM VALUES</div><p>Enter one value per line. Values have no type.</p><div><code>ready</code></div><div><code>disorganised</code></div><div><code>routed</code></div><p>Enter saves a value. ↑↓ select values for overwriting. ← returns to a referring entity.</p></div> : <div className="syntax-guide"><div className="eyebrow">PROPERTY SYNTAX</div><div><code>name</code><span>string by default</span></div><div><code>strength int</code><span>typed value</span></div><div><code>leader Person</code><span>entity reference</span></div><div><code>units Unit *</code><span>one to many</span></div><div><code>organisation enum</code><span>enum</span></div><p>Unknown types create entities. Enum properties create a value list; → opens it.</p><div className="primitive-list">{PRIMITIVES.map(t => <span key={t}>{t}</span>)}</div></div>}
          <div className="inspector-footer"><span className="little-square" />{references.length} incoming / {selected.properties.filter(p => !isPrimitive(p.type)).length} outgoing</div>
        </> : <div className="inspector-empty"><Box size={28} strokeWidth={1.2} /><p>Select an entity to see its properties.</p><button className="button" onClick={() => openModal('new')}>Create an entity</button></div>}
      </aside>}
    </main>
    <footer className="statusbar"><span className={`mode ${leader ? 'leader-mode' : focusedInput ? 'input-mode' : ''}`}>{leader ? 'LEADER' : focusedInput ? 'INSERT' : 'NORMAL'}</span><span className="status-message">{notice || (leader ? 'Choose a command…' : focusedInput ? 'Esc cancels editing' : '')}</span><button onClick={() => openModal('help')}><kbd>Space</kbd><span>then a key</span><span className="statusbar-divider">/</span><kbd>?</kbd><span>help</span></button></footer>
    {leader && <div className="leader-menu"><span className="eyebrow">SPACE →</span>{shortcuts.map(([key, label]) => <button key={key} onClick={() => { setLeader(false); const commands = { n: () => openModal('new'), j: () => openModal('jump'), p: focusProperty, r: () => openModal('rename'), x: () => openModal('export'), f: () => fit(), a: arrange, u: undo, y: redo, h: () => openModal('help') }; commands[key]?.(); }}><kbd>{key.toUpperCase()}</kbd>{label}</button>)}</div>}
    {modal && <div className="modal-backdrop" onPointerDown={e => { if (e.target === e.currentTarget) { setModal(null); setError(''); } }}><div className={`modal ${modal === 'export' ? 'export-modal' : ''} ${modal === 'help' ? 'help-modal' : ''}`} role="dialog" aria-modal="true" aria-labelledby="dialog-title"><button className="modal-close icon-button" aria-label="Close dialog" onClick={() => { setModal(null); setError(''); }}><X size={18} /></button>
      {(modal === 'new' || modal === 'rename') && <form onSubmit={submitName}><div className="modal-symbol"><Box size={23} /></div><h2 id="dialog-title">{modal === 'new' ? 'New entity' : 'Rename'}</h2><p className="modal-description">{modal === 'new' ? 'Enter a name, then add properties.' : 'References update automatically.'}</p><label className="field-label" htmlFor="entity-name">ENTITY NAME</label><input ref={modalInputRef} id="entity-name" className="modal-input" placeholder="e.g. SupplyRoute" autoComplete="off" spellCheck="false" value={nameDraft} onChange={e => { setNameDraft(e.target.value); setError(''); }} />{error && <p className="error" role="alert">{error}</p>}<div className="modal-bottom"><span><kbd>Esc</kbd> cancel</span><button className="button primary" type="submit" disabled={!nameDraft.trim()}>{modal === 'new' ? 'Create entity' : 'Rename'}<span>↵</span></button></div></form>}
      {modal === 'jump' && <><h2 id="dialog-title">Jump to entity</h2><p className="modal-description">Type to filter entities.</p><div className="jump-input"><Search size={18} /><input ref={modalInputRef} value={query} aria-label="Filter entities" placeholder="Search entities…" onChange={e => { setQuery(e.target.value); setJumpIndex(0); }} onKeyDown={e => { if (e.key === 'ArrowDown') { e.preventDefault(); setJumpIndex(i => Math.min(filtered.length - 1, i + 1)); } if (e.key === 'ArrowUp') { e.preventDefault(); setJumpIndex(i => Math.max(0, i - 1)); } if (e.key === 'Enter' && filtered[jumpIndex]) { select(filtered[jumpIndex].id); centreOn(filtered[jumpIndex]); setModal(null); } }} /></div><div className="jump-results">{filtered.map((e, i) => <button key={e.id} className={jumpIndex === i ? 'highlighted' : ''} onMouseEnter={() => setJumpIndex(i)} onClick={() => { select(e.id); centreOn(e); setModal(null); }}><Box size={17} /><span>{e.name}</span><small>{entityRows(e).length} properties</small><span>↵</span></button>)}{!filtered.length && <div className="no-results">No entities found.<button onClick={() => { setNameDraft(query); setModal('new'); }}>Create “{query || 'an entity'}”<Plus size={13} /></button></div>}</div><div className="jump-footer"><span><kbd>↑</kbd><kbd>↓</kbd> navigate</span><span><kbd>Enter</kbd> jump</span><span><kbd>Esc</kbd> close</span></div></>}
      {modal === 'export' && <><div className="modal-symbol"><Braces size={24} /></div><h2 id="dialog-title">Export sketch</h2><p className="modal-description">{document.entities.length} types, {relationships.length} connections. </p><div className="export-tabs"><button className={exportFormat === 'json' ? 'active' : ''} onClick={() => setExportFormat('json')}><FileJson size={15} />JSON<span>data + layout</span></button><button className={exportFormat === 'plantuml' ? 'active' : ''} onClick={() => setExportFormat('plantuml')}><Braces size={15} />PlantUML<span>class diagram</span></button></div><textarea className="export-preview" aria-label="Export preview" value={exports} readOnly spellCheck="false" /><div className="export-note">{exportFormat === 'json' ? 'JSON can be imported to restore the sketch.' : 'Open the .puml file with any PlantUML renderer.'}</div><div className="modal-bottom"><button className="button" onClick={copyExport}><Copy size={15} />Copy</button><button className="button primary" onClick={() => download(exports, exportFormat === 'json' ? 'json' : 'puml')}><Download size={15} />Download {exportFormat === 'json' ? '.json' : '.puml'}</button></div></>}
      {modal === 'help' && <><div className="modal-symbol"><Keyboard size={24} /></div><h2 id="dialog-title">Keyboard shortcuts</h2><p className="modal-description">Press <kbd>Space</kbd>, release, then press a command key.</p><div className="shortcut-grid">{shortcuts.map(([key, label]) => <div key={key}><span>{label}</span><span><kbd>Space</kbd><kbd>{key.toUpperCase()}</kbd></span></div>)}</div><div className="extra-shortcuts"><span><kbd>Enter</kbd> new property / value</span><span><kbd>↑ / ↓</kbd> select row to overwrite</span><span><kbd>← / →</kbd> navigate linked entities</span><span><kbd>Esc</kbd> leave input / close</span><span><kbd>Delete</kbd> delete entity</span><span><kbd>Ctrl / ⌘ K</kbd> jump to entity</span><span><kbd>Ctrl / ⌘ Z</kbd> undo outside inputs</span><span><kbd>Shift + Ctrl / ⌘ Z</kbd> redo</span></div><div className="help-syntax"><strong>Properties, one line at a time</strong><code>name <span>→ str</span><br />strength int <span>→ int</span><br />commander Person <span>→ links + creates Person</span><br />armies Army * <span>→ one to many</span><br />organisation enum <span>→ enum value list</span></code><p>Edit in the highlighted graph row. ↑ / ↓ select a property for overwriting. ← / → move between entities. Enter saves and starts a new row. Modified arrows edit text; Escape cancels.</p></div><button className="button primary full-width" onClick={() => setModal(null)}>Close<Check size={15} /></button></>}
      {modal === 'delete' && <><div className="modal-symbol danger"><Trash2 size={23} /></div><h2 id="dialog-title">Delete {selected?.name}?</h2><p className="modal-description">Removes the selected type and its contents.{references.length > 0 && ` It also removes ${references.length} properties that reference it: ${references.join(', ')}.`} Undo is available.</p><div className="modal-bottom"><button ref={modalInputRef} className="button" onClick={() => setModal(null)}>Keep entity</button><button className="button destructive" onClick={() => { commit(removeEntity(document, selectedId), `Deleted ${selected?.name}`); setSelectedId(null); setDraft(''); setEditingId(null); setModal(null); }}>Delete entity</button></div></>}
      {modal === 'clear' && <><div className="modal-symbol"><RotateCcw size={23} /></div><h2 id="dialog-title">New sketch</h2><p className="modal-description">Replaces the current sketch with an empty sketch. Undo restores it.</p><div className="modal-bottom"><button ref={modalInputRef} className="button" onClick={() => setModal(null)}>Keep sketch</button><button className="button primary" onClick={() => { commit({ name: 'Untitled sketch', entities: [] }, 'New sketch · Space N to begin'); setSelectedId(null); setDraft(''); setEditingId(null); setModal(null); setStorageProblem(''); }}>Start blank<ArrowRight size={15} /></button></div></>}
      {modal === 'import-error' && <><h2 id="dialog-title">Couldn’t import that sketch.</h2><p className="error" role="alert">{error}</p><p className="modal-description">Current sketch was not changed. Select an Entity JSON export.</p><button ref={modalInputRef} className="button primary" onClick={() => { setModal(null); setError(''); }}>Back to sketch</button></>}
    </div></div>}
  </div>;
}

createRoot(window.document.getElementById('root')).render(<App />);
