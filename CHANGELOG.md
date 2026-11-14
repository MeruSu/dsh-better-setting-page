# Changelog

Notable changes to `dsh-better-setting-page`.

Two version numbers exist in this project and they are not the same thing:

- `package.json` `version` — the npm/GitHub release version.
- the stored settings `version` — moves only when the shape of the saved record
  changes. This release ships shape `1`.

## 0.1.4 — 2026-11-14

Settings pages can be hidden from the rail without being uninstalled, and every
hidden page stays reachable from **Settings → Settings page**.

### Added

- A **hidden pages** list on this plugin's own settings page. The list comes from
  the slot registry (`ctx.slots.entries("settings.section")`), not from the DOM:
  at cold start the rail is not mounted, so a DOM-driven list would come back
  empty and overwrite the user's choices with nothing.
- Per-row **hide / restore**. The row of a hidden page stays in the list and
  stays clickable; clicking it opens that page. Hiding is not a one-way door, and
  that is the whole point of the feature.
- `sanitizeHidden()`: strings only, trimmed, deduplicated, empty string and this
  page's own id dropped, capped at `HIDDEN_MAX` (64).
- Opening goes through the shell store (`openSection`) and then polls
  `aria-current` for ~320 ms (`OPEN_ATTEMPTS` 8 × `OPEN_INTERVAL_MS` 40); when the
  store call does not land, the nav row is clicked directly. The store only sets
  `activeId` — it does not guarantee a render.
- 17 more unit checks (36 → 53), including the exact shape of the single hiding
  rule, an idempotent checkbox write, and the self-row staying read-only.

### Changed

- The stylesheet now contains exactly **one** `display: none` rule, scoped to
  `nav [data-bsp-hidden="1"]:not([aria-current="true"])`. It exists because
  hiding a nav row *is* the feature; the mask, the close button and page bodies
  remain untouchable, and two unit checks that used to assert "no `display: none`
  anywhere" now assert "exactly this one rule and nothing else".
- `:not([aria-current="true"])` keeps the row of the page you are on visible, so
  the rail still shows where you are after opening a hidden page.

Stored record gains `hidden: []`; `settings.version` stays `1`.

## 0.1.3 — 2026-11-14

Metadata release: the plugin now has a display name, a description and an icon
in the host's plugin list, instead of showing the bare package name.

### Added

- `locale/en.json` and `locale/zh.json` with `meta.title` / `meta.description`,
  and `icon.svg` declared as `package.json` `icon`. The host reads these without
  evaluating any JavaScript (`pluginPackages.metaOf`), so all three have to be
  reachable through `exports` and included in `files` — otherwise the published
  tarball lacks them and the list falls back to the package name.
- Three unit checks for exactly that: the manifest declares them, the icon is
  packaged and under the host's 256 KiB cap, and both languages carry a title and
  a description.

No code and no stored field changed; `settings.version` stays `1`.

## 0.1.2 — 2026-11-14

Layout-only release. No stored field changed, so `settings.version` stays `1`
and there is no migration.

### Fixed

- **The top-left toggle now stays top-left in every shell.** 0.1.1 flattened
  the two wrapper boxes so the toggle became a flex item of the header, but it
  still relied on being *registered* first. The browser build registers it
  first; the desktop shell registers the shipped actions first, so there the
  toggle landed to the *right* of "open config file". The toggle now carries
  `order: -1`, which pins it to the visual start regardless of DOM order. This
  was verified by swapping the two children in the live DOM and re-measuring:
  the toggle stayed at x `66` while the shipped action moved to x `1108`.

### Changed

- **The settings page content is centred.** In full screen the column is the
  whole window, so a capped page used to hug the left edge of a wide monitor.
  Pages inside `[data-slot="settings.section"]` now get `margin-inline: auto`
  next to the `max-width: 880px` cap: at a 1208px column the page lands at
  x `220` with equal 124px gutters, and the host's own pages (General settings)
  centre the same way.

### Note

- `client.js` is now pure LF. It had picked up CRLF line endings, which is what
  made a `node --check` diagnostic point at the wrong column earlier.

## 0.1.1 — 2026-11-14

Layout-only release: the header now reads left-to-right the way a settings page
is expected to. No stored field changed, so `settings.version` stays `1` and no
migration is involved.

### Changed

- **Collapse on the left, exit on the right.** The rail toggle moved from beside
  the shipped *Open config file* button to the top-left corner of the header, and
  the shipped close button now draws a **return arrow** instead of an ✕. The
  button itself is untouched — same node, same click handler, same accessible
  name from the host's `settings.close` slot, same `Esc` and click-outside paths.
- The toggle reaches the corner by flattening its two wrapper boxes with
  `display: contents` (`.actions` and the slot outlet), not by `order`: it is a
  grandchild of the header, so `order` could only reorder it inside `.actions`.
  One side effect is that the Tab order is now the visual order — toggle, then
  the shipped buttons, then the close button — without needing `reading-flow`.

### Added

- Three test groups (30 → **33**) covering the header layout: the flattening
  contract, that the close button is restyled rather than moved or replaced, and
  that the arrow is drawn as a mask. Mutating any of the three turns them red
  (verified by reverting each rule in turn).

### Verification

| Gate | Result |
|---|---|
| `node --check client.js` / `index.js` / `test/settings-page.test.mjs` | `0` / `0` / `0` |
| `node test/settings-page.test.mjs` | `PASS — 33 groups` |
| static gate (`261115_bsp_gate.mjs`) | `STATIC VERDICT: clean` |

Real-machine check on the **web** runtime (Harness `0.2.2-rc.1`, profile
`meru-test`, viewport 900×1323):

| Check | Result |
|---|---|
| Toggle sits at the header's left edge | **PASS** — x `66` collapsed (rail is 56px wide, first icon cell ends at 48), x `198` expanded (header starts at 188) |
| Close button stays at the right edge, arrow glyph | **PASS** — x `846` in both states, `svg` computed `visibility: hidden`, `::after` 14×14 mask |
| Tab order matches the visual order | **PASS** — `收起/展开分类栏@198 → 打开配置文件@744 → 关闭@846` |
| All three close paths still work | **PASS** — close button, `Esc`, mask click |
| Collapsed toggle does not cover the first icon | **PASS** — toggle `66–94`, first nav cell `8–48` |

### Notes

- The arrow is an inline SVG used as a `mask`, so it inherits `currentColor` and
  therefore the host theme (hover, dark mode) without a second copy of the glyph.
  A text `U+21A9` was rejected: it would depend on the font carrying the glyph.
- No `!important`, no `display: none` (the shipped glyph is `visibility: hidden`
  and absolutely positioned instead of removed), no new DOM node.

## 0.1.0 — 2026-11-14

First working release. `0.0.1` existed only to reserve the package name and did
nothing at runtime.

### Added

- **Full-window settings page.** The harness opens settings as an 800px modal;
  this release makes the panel fill the window (no radius, no drop shadow) and
  keeps the desktop title-bar height as top padding so the drag strip survives.
- **Collapsible section rail.** A chevron in the page header collapses the
  188px section list to a 56px icon column and back. The rail state is one
  attribute on `<html>`; collapsing is pure CSS — no host state is read or
  written.
- **Both choices remembered** in `localStorage` under
  `dsh.better-setting-page.settings` (`{ version, fullscreen, navCollapsed,
  unknown }`). Unrecognised keys are carried in `unknown` and written back, so a
  downgrade does not lose data.
- **Its own settings page** (Settings → Settings page): two switches and
  *Restore defaults*. Without it, a user who dislikes full screen would have to
  uninstall the plugin.

Full screen defaults to **on**, the rail to **expanded**; both are switchable.

### Notes on what was deliberately not done

- The mask is **not** hidden. The host attaches click-outside-to-close to it, so
  the plugin only strips its paint (`background: transparent;
  backdrop-filter: none`) and leaves the box and its `onClick` intact.
- No `!important`, no host hash class names, no writes to any host store.
- `html[data-fullscreen]` (the *window's* state) is never forced: doing so would
  also move where the host anchors its menus.

### Verification

Static gates, re-run by the maintainer on 2026-11-14:

| Gate | Result |
|---|---|
| `node --check client.js` / `index.js` / `test/settings-page.test.mjs` | `0` / `0` / `0` |
| `node test/settings-page.test.mjs` | `PASS — 30 groups` |
| static gate (`261115_bsp_gate.mjs`: undeclared constants + 9 required anchors + 5 forbidden patterns) | `STATIC VERDICT: clean` |

Real-machine check on the **web** runtime (Harness `0.2.2-rc.1`, profile
`meru-test`, viewport 1600×950), three of four items passing:

| Check | Result |
|---|---|
| Panel fills the window | **PASS** — panel rect `{ x: 0, y: 0, w: 1600, h: 950 }` equals the viewport; computed `grid-template-columns: "188px 1412px"` |
| Rail collapses | **PASS** — `188px 1412px` → `56px 1544px`; `html[data-bsp-nav="collapsed"]`; toggle reports `aria-expanded="false"`; the first real `Tab` press lands on the toggle |
| Choice survives reload, `Esc` and the close button still close | **PASS** |
| Desktop 40px title-bar drag strip | **not verified** — see below |

### Known limitations

- **The desktop 40px title-bar behaviour is unverified on a real Desktop app.**
  On the web runtime `html[data-windows-titlebar]="false"`,
  `--dsh-windows-titlebar-height` is unset and the computed padding is
  `max(0px, 0px)`, so the one thing this release cannot demonstrate is the thing
  it was written for. The drag strip is a `::before` overlay with
  `-webkit-app-region: drag`; the host's own frame uses the same technique, but
  that is reasoning, not a measurement. Treat it as **unverified** until a
  desktop run says otherwise.
- **This is not a window full-screen toggle.** It fills the window that exists.
- **Narrow windows keep the host layout.** Below 768px the harness turns the
  panel into a full-screen sheet on its own, so the collapse rules sit behind
  `@media (min-width: 768px)`.
- **Settings are per origin.** A different port is a different browser profile
  and the two switches reset there.
- **Anchor stability.** Everything hangs on `div[data-shortcut-modal="settings"]`
  and on the `settings.action` / `settings.section` slot names. If a future
  harness renames any of them the plugin stops taking effect — it does not
  crash, it just quietly does nothing.
