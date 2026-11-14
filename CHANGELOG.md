# Changelog

Notable changes to `dsh-better-setting-page`.

Two version numbers exist in this project and they are not the same thing:

- `package.json` `version` — the npm/GitHub release version.
- the stored settings `version` — moves only when the shape of the saved record
  changes. This release ships shape `1`.

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
