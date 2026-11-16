# Entity

A keyboard-driven tool for quickly sketching objects and their relationships. Define entities, typed properties, enums and collections in a visual graph, then export JSON or PlantUML.

[Open the editor](https://coljac.github.io/entity/)

The app runs entirely in the browser. No backend, database or accounts are required. Sketches are saved in browser local storage; export JSON for a portable backup. The starter example models projects, tasks, people and a status enum. **New sketch** starts a blank sketch.

The hosted site and localhost have separate browser storage. To move an existing sketch, export JSON from the local app and import it on the hosted site.

## Run

Requires Node.js 22.12+ and npm.

```sh
npm ci
npm run dev
```

Open the address printed by Vite. For a production build, run `npm run build`; the static files are written to `dist/`.

Optional just recipes use [Portly](https://github.com/coljac/portly), a CLI for managing local app ports and server processes:

```sh
just install
just register  # once, if not already registered with Portly
just run
```

`just run` starts the editor and tails its log. Ctrl-C leaves it running; `just stop` stops it. `just restart`, `just open`, `just build` and `just check` are also available. Portly supplies the port; `portly get entity frontend` prints it.

## GitHub Pages

Pushes to `main` run the model tests, build the static site and deploy it to GitHub Pages. The deployment can also be triggered manually from the Actions tab. Repository Settings → Pages must use **GitHub Actions** as its source.

Asset URLs are relative, so the build supports a repository subpath such as `/entity/`. No deployment secrets or server configuration are needed.

## Keyboard

The leader is **Space**, pressed and released before the next key. Commands operate outside text inputs; **Escape** leaves an input or closes a dialog.

| Keys | Action |
| --- | --- |
| Space N | New entity; Enter its name, then type properties |
| Space J / Ctrl+K / Cmd+K | Fuzzy-filter entities; arrows + Enter to jump |
| Space P / Enter | Add properties to selected entity |
| Up / Down | Move through properties; the whole line is selected for overwriting |
| Left / Right | Move to a parent / linked entity, falling back to nearby cards |
| Space R | Rename selected entity and its references |
| Space X | JSON / PlantUML export |
| Space F | Fit the graph |
| Space A | Arrange cards |
| Space U / Ctrl+Z / Cmd+Z | Undo (outside text inputs) |
| Space Y / Shift+Ctrl+Z / Shift+Cmd+Z | Redo |
| Space H / ? | Help |
| Delete / Backspace | Delete selected entity, with confirmation |

## Property syntax

Type one property per line. Enter saves and leaves the input ready for another property.

```text
name                  # str, one to one
count int             # int, one to one
owner Person          # links to Person, creates it if missing
items Item *          # Item collection, one to many
scores int *          # int collection
status enum           # creates a Status enum with a value list
```

The comments above are explanatory; enter just the property syntax. Built-in types: `str`, `int`, `float`, `bool`, `date`, `datetime`, `uuid`, `json`. Aliases `string`, `integer`, `number`, `boolean` are accepted. Names use letters, digits and underscores and must start with a letter or underscore. Entity names are unique without regard to case.

Edit directly in the graph card. The active entity has a strong green outline; the current property is highlighted in amber and the new-property row is green. The inspector mirrors the same draft and can be hidden while you work.

Up / Down move through property rows and select the whole line: `PropName`, Enter, Up, then typing `NewProp` replaces that property. Enter saves and jumps to a fresh row at the bottom, including when editing a property in the middle. Moving with the arrows saves valid changes first; invalid input stays highlighted until corrected or cancelled with Escape.

Right follows the selected class property, or the nearest outgoing link; Left returns to a referring entity, favouring the one you came from. Without links, the app chooses a nearby card in that direction. Returning to an entity restores its property cursor. Modified arrows (Shift / Ctrl / Alt / Cmd) retain normal text-editing behaviour.

Click a property to edit it. Tab completes a suggested type. Re-entering an existing property name updates it. New entity types create empty entities. Renaming updates all references; deleting an entity also removes properties referencing it, with confirmation and undo.

## Enums

`status enum` creates an enum named `Status` and a reference to it. After Enter saves the property, press Right to open the enum. Enter values directly, one per line:

```text
draft
active
archived
```

Values have no type or multiplicity. Enter saves and starts a new value row; Up / Down select existing values for overwriting. Left returns to a referring entity. Enum cards use a list icon and enum links are dashed purple.

Each property declared with `enum` gets its own definition. Naming collisions use the owning entity as a prefix, for example `TaskStatus`. Re-entering `enum` on an existing enum property retains its values. To share an enum explicitly, use its name as a property type: `fallback Status`.

JSON stores enum definitions as `kind: "enum"` with a `values` array of `{ "id": "…", "value": "draft" }` entries. Import also accepts plain string values. Existing version 1 sketches still load. PlantUML exports an `enum` declaration and a dashed reference using the [class diagram syntax](https://plantuml.com/class-diagram).

Drag card headers to position them, drag the canvas to pan, scroll to zoom, or use the graph toolbar. Double-click a card to enter properties. JSON preserves names, types, cardinalities, IDs and layout and can be imported again. Import replaces the current sketch and can be undone. PlantUML exports class definitions and labelled 1:1 / 1:N associations. There is no PlantUML import.

Browser storage is per origin (host + port), so use the same address each time. History is in memory; reload keeps the current sketch but clears undo history. Sketches saved by earlier releases load automatically, and their JSON exports remain importable.

`just check` runs the model checks and production build. To check keyboard editing in the browser, install Playwright Chromium once with `npx playwright install chromium`, start the editor, then run `npm run test:browser` (or `just test-browser` when using Portly). Set `ENTITY_BASE_URL` if the editor uses a different address, or `BROWSER_EXECUTABLE` to use an existing Chromium or Chrome binary. Browser checks use isolated storage.
