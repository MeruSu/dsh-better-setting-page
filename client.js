/**
 * Browser half of `dsh-better-setting-page` — full-screen settings page with a
 * collapsible navigation rail.
 *
 * What it does (and nothing else):
 *   1. One stylesheet that turns the shipped settings dialog into a full-window
 *      page and narrows its left rail to 56px when collapsed. Every rule hangs
 *      off two attributes we own on `<html>`, so the panel can be unmounted and
 *      remounted by the host at any time and the state survives without any
 *      MutationObserver.
 *   2. One button in the `settings.action` slot that toggles the rail, pinned to
 *      the top-left corner of the header (see "header layout" below).
 *   3. One `settings.section` page with the two switches and "restore defaults",
 *      because a plugin that can only be undone by clearing localStorage is a
 *      plugin the user cannot turn off.
 *
 * Header layout: collapse on the left, exit on the right. The shipped close
 * button stays exactly where the host put it and keeps its own click handler and
 * accessible name; only its glyph changes to a return arrow. We reach the
 * top-left corner by flattening the two wrapper boxes with `display: contents`
 * rather than by `order`, because the toggle lives two levels down inside
 * `.actions` and `order` cannot move a node out of its flex parent.
 *
 * Deliberate non-goals: no `settings.header` takeover (that slot is the dialog's
 * `aria-labelledby` target and shadows shipped UI), no `display:none` on the
 * mask (its `onClick` is the click-outside-to-close handler), no removing or
 * re-parenting the shipped close button, no `!important`, no hash class names,
 * no host store writes.
 *
 * Selector notes that are easy to get wrong (verified against the shipped DOM):
 *   - `[data-slot="…"]` is emitted by the renderer's `SlotOutlet` with
 *     `style:{display:"contents"}`. It produces no box, so it can be used to
 *     anchor a selector but never as a sized container.
 *   - It sits inside `.actions` / `.options`, never directly under `.header`.
 *     Matching the header row therefore has to use a descendant combinator:
 *     `> div:has([data-slot="settings.action"])`.
 *   - A catch-all `button:last-child` on the header would also match our own
 *     toggle, because with `.actions` flattened every button becomes a direct
 *     child of the header. The close button is therefore addressed as
 *     `> button:last-of-type` **and** every rule that touches it is scoped to the
 *     arrow glyph only.
 *   - `clip` alone does not hide anything: the visually-hidden utility below
 *     needs absolute positioning plus `clip-path`.
 */

window.__ModuleLoader__.load({
  id: 'dsh-better-setting-page',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    /** Locale namespace and the prefix of every DOM attribute we own. */
    const NS = 'better-setting-page'
    const VERSION = '0.1.2'

    /** localStorage key. Bumping `SETTINGS_VERSION` requires a migration. */
    const STORE_KEY = 'dsh.better-setting-page.settings'
    const SETTINGS_VERSION = 1

    const DEFAULTS = {
      version: SETTINGS_VERSION,
      fullscreen: true,
      navCollapsed: false,
    }

    /** `<html>` attributes: the only state the stylesheet reads. */
    const FULLSCREEN_ATTR = 'data-bsp-fullscreen'
    const NAV_ATTR = 'data-bsp-nav'
    /** Id we lend to the host's `<nav>` so `aria-controls` has a target. */
    const NAV_ID = 'dsh-bsp-nav'

    const PANEL = 'div[data-shortcut-modal="settings"]'

    const SECTION_ID = 'better-setting-page'
    const SECTION_ORDER = 50
    const ACTION_ID = 'better-setting-page.rail-toggle'

    //#region stylesheet
    /**
     * The whole visual layer. No `!important` anywhere: `div[data-shortcut-modal
     * ="settings"]` is (0,1,1) against the shipped module classes at (0,1,0), and
     * every rule below is at least that specific.
     */
    const CSS = `
/* ── 1. Full-screen panel ───────────────────────────────────────────────── */
html[data-bsp-fullscreen="on"] div[data-shortcut-modal="settings"]{
  --bsp-top-pad: max(var(--dsh-windows-titlebar-height, 0px), var(--dsh-frame-top-clearance, 0px));
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  max-width: none;
  max-height: none;
  border-radius: 0;
  box-shadow: none;
  padding-top: var(--bsp-top-pad);
  background: var(--dsw-alias-bg-layer-2);
}

/* A genuinely full-screen window has no title bar, so there is nothing to pad. */
html[data-bsp-fullscreen="on"][data-fullscreen] div[data-shortcut-modal="settings"]{
  --bsp-top-pad: 0px;
}

/* The pad strip is window chrome, not page content: keep it draggable, but only
   on desktop, where that strip actually exists. */
html[data-windows-titlebar][data-bsp-fullscreen="on"] div[data-shortcut-modal="settings"]::before,
html[data-platform="darwin"][data-bsp-fullscreen="on"] div[data-shortcut-modal="settings"]::before{
  content: "";
  position: absolute;
  inset: 0 0 auto 0;
  height: var(--bsp-top-pad);
  -webkit-app-region: drag;
}

/* ── 2. Mask keeps its hit area, loses only its paint ───────────────────── */
/* The mask owns the click-outside-to-close handler. Hiding it or switching off
   its pointer events does not "clean up the overlay", it deletes a feature with
   no error. Only the paint is removed here; the box stays. */
html[data-bsp-fullscreen="on"] div:has(> div[data-shortcut-modal="settings"]) > div:first-child{
  background: transparent;
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
}

/* ── 3. Content column ──────────────────────────────────────────────────── */
/* Header row: the action slot lives inside .actions, so match by descendant. */
html[data-bsp-fullscreen="on"] div[data-shortcut-modal="settings"] > div:has([data-slot="settings.action"]){
  padding-right: 26px;
}
/* Content column is the direct parent of the section outlet. */
html[data-bsp-fullscreen="on"] div[data-shortcut-modal="settings"] > div:has(> [data-slot="settings.section"]){
  min-height: 0;
}
/* Wide windows get breathing room; narrow ones keep the host's tighter padding. */
@media (min-width: 768px){
  html[data-bsp-fullscreen="on"] div[data-shortcut-modal="settings"] > div:has(> [data-slot="settings.section"]){
    padding: 0 40px 40px;
  }
}
/* A full-width page would otherwise run a line across the whole monitor, and on a
   wide screen it would also hang off the left edge: the column is a plain block
   box, so a capped child stays where the padding puts it unless it is centred.
   Centring is done with auto inline margins rather than by centring the column
   itself, because the host's own pages also cap their width and would otherwise
   stay left-aligned inside a wide column. */
html[data-bsp-fullscreen="on"] div[data-shortcut-modal="settings"] [data-slot="settings.section"] > *{
  max-width: 880px;
  margin-inline: auto;
}

/* ── 4. Collapsible rail ────────────────────────────────────────────────── */
/* Everything about collapsing is behind the same breakpoint the host uses to
   turn the rail into a horizontal tab bar (<=767px). Collapsing a horizontal bar
   has no meaning, and hiding its labels there would leave an unlabelled strip. */
@media (min-width: 768px){
  /* Only the grid-template-columns longhand: the area names in the shorthand are
     CSS-Modules hashes and would break on the next build. */
  html[data-bsp-nav="collapsed"] div[data-shortcut-modal="settings"]{
    grid-template-columns: 56px minmax(0, 1fr);
  }
  html[data-bsp-nav="collapsed"] div[data-shortcut-modal="settings"] > nav{
    padding: 10px 8px 0;
  }
  html[data-bsp-nav="collapsed"] div[data-shortcut-modal="settings"] > nav > div > button{
    /* Anchors the visually-hidden label to its own cell instead of the panel. */
    position: relative;
    justify-content: center;
    padding: 9px 0;
    gap: 0;
  }
  /* The panel title stays readable, it just loses its 24px indent. Hiding it
     would also hide the dialog's accessible name, which is this node. */
  html[data-bsp-nav="collapsed"] div[data-shortcut-modal="settings"] > div[id]{
    padding: 22px 4px 8px;
    overflow: hidden;
    font-size: 13px;
    line-height: 24px;
    text-align: center;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  /* Visually hidden, still in the accessibility tree: with the label gone the
     icon is all that is left, and the icon carries no accessible name of its
     own. Second span rather than last-child, so that a cell rendered without an
     icon span never causes the icon itself to be hidden. */
  html[data-bsp-nav="collapsed"] div[data-shortcut-modal="settings"] > nav > div > button > span:nth-child(2){
    position: absolute;
    width: 1px;
    height: 1px;
    margin: -1px;
    padding: 0;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
    border: 0;
  }
}

/* ── 5. Header layout: toggle left, then the shipped actions and exit right ── */
/* The header is a flex row with justify-content: space-between and exactly two
   children: .actions (a flex row holding the slot outlet, which holds the
   shipped action buttons plus ours) and the shipped close button. Our toggle is
   a grandchild of the header — header > .actions > [data-slot] > button — so no
   order value can move it out of .actions until those wrappers are flattened.

   Flattening the two wrappers with display: contents promotes the slot's
   children to real flex items of the header. The slot outlet already uses
   display: contents, so this only adds the one level that was in the way.

   Once flattened, the toggle is *a* flex item but not necessarily the *first*
   one: the order of the slot's children is registration order, and the shipped
   actions that register into settings.action can come before ours (measured: the
   browser build puts ours first, the desktop shell puts the shipped ones first).
   An earlier revision relied on being first and therefore only looked right in
   one of the two. order: -1 pins the toggle to the visual start regardless of
   DOM order, and space-between is replaced by flex-start + an auto margin on the
   toggle so that the shipped actions and the close button stay adjacent at the
   far right instead of drifting to the middle.

   Tab order still follows the flattened DOM, not order. That is why the toggle
   carries tabIndex in registration order and why the panels below are not
   reordered with order: visual order and focus order only diverge for the
   toggle, and it is the first thing the dialog's own roving focus reaches. */
/* Being first in 'order' is not enough on its own: 'space-between' would still
   distribute the items by their own sizes and pull the shipped actions away from
   the close button. flex-start plus an auto margin on the toggle keeps the
   toggle at the visual start and parks everything else against the right edge,
   with the shipped actions immediately before the close button. */
div[data-shortcut-modal="settings"] > div:has([data-slot="settings.action"]) > div:has(> [data-slot="settings.action"]){
  display: contents;
}

/* The action slot outlet in the middle is already display: contents from the
   renderer. Restated so a future change to that inline style cannot silently
   break the header layout into a stack. */
div[data-shortcut-modal="settings"] > div:has([data-slot="settings.action"]) > div:has(> [data-slot="settings.action"]) > [data-slot="settings.action"]{
  display: contents;
}

/* The header itself becomes a plain left-aligned row. Both properties are needed
   once the wrappers above are flattened, because the shipped header relies on
   space-between between exactly two boxes. */
div[data-shortcut-modal="settings"] > div:has([data-slot="settings.action"]){
  justify-content: flex-start;
}

/* Visual start, whatever the registration order was. The anchor in between is a
   real element in the DOM (only display:contents makes it look transparent), so
   the selector has to span it instead of assuming the toggle is a direct child of
   the header. */
div[data-shortcut-modal="settings"] [data-slot="settings.action"] > .bsp-rail-toggle{
  order: -1;
  margin-right: auto;
}

/* The return arrow used for the shipped close button, as a mask so it inherits
   the button's color and therefore the host theme (hover, dark mode) without a
   second copy of the glyph. Inline SVG because the shipped icon set is a sprite
   we must not fork; a text glyph would depend on the font carrying U+21A9. The
   custom property lives on the button itself so no ungated panel rule is needed
   and ::after inherits it. */
/* The shipped close button, and only it: last-of-type on the header level. Its
   glyph becomes a return arrow. The button keeps its box, its accessible name
   (the host fills it through the settings.close slot) and its click handler —
   Esc and click-outside remain untouched, and the node is never removed. */
/* The shipped glyph is taken out of flow and made invisible rather than
   display:none: the project forbids that property outright, and keeping the node
   in the tree means the host's icon still exists for anything that looks it up by
   data-icon. Absolute positioning keeps it from adding 14px next to the arrow. */
div[data-shortcut-modal="settings"] > div:has([data-slot="settings.action"]) > button:last-of-type{
  --bsp-return-icon: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='none' stroke='black' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'><path d='M6.5 3.5 3 7l3.5 3.5'/><path d='M3 7h6.25A3.75 3.75 0 0 1 13 10.75v1.75'/></svg>");
  position: relative;
}
div[data-shortcut-modal="settings"] > div:has([data-slot="settings.action"]) > button:last-of-type > svg{
  position: absolute;
  visibility: hidden;
}
div[data-shortcut-modal="settings"] > div:has([data-slot="settings.action"]) > button:last-of-type::after{
  content: "";
  position: absolute;
  inset: 0;
  margin: auto;
  width: 14px;
  height: 14px;
  background-color: currentColor;
  -webkit-mask: var(--bsp-return-icon) center / contain no-repeat;
  mask: var(--bsp-return-icon) center / contain no-repeat;
}

/* ── 6. Rail toggle button (settings.action) ────────────────────────────── */
[data-slot="settings.action"] > .bsp-rail-toggle{
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 0;
  border-radius: var(--dsw-radius-sm);
  background: transparent;
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
}
[data-slot="settings.action"] > .bsp-rail-toggle:hover{
  background-color: var(--dsw-alias-interactive-bg-hover);
}
[data-slot="settings.action"] > .bsp-rail-toggle:focus-visible{
  outline: var(--dsw-focus-ring-width, 2px) solid
           var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: -2px;
}

/* ── 7. Our own settings page ───────────────────────────────────────────── */
.bsp-page{
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-width: 880px;
  padding: 8px 2px 28px;
}
.bsp-head{ padding: 4px 0 12px; }
.bsp-title{
  margin: 0 0 6px;
  font-size: 16px;
  font-weight: 650;
  letter-spacing: -0.01em;
  color: var(--dsw-alias-label-primary);
}
.bsp-sub{
  margin: 0;
  max-width: 64ch;
  font-size: 12px;
  line-height: 1.55;
  color: var(--dsw-alias-label-tertiary);
}
.bsp-row{
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  padding: 16px 0;
  border-bottom: .5px solid var(--dsw-alias-border-l2);
}
.bsp-rowText{ min-width: 0; }
.bsp-rowLabel{
  font-size: 14px;
  line-height: 20px;
  color: var(--dsw-alias-label-primary);
}
.bsp-rowHint{
  margin-top: 4px;
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-secondary);
}
.bsp-check{
  flex: none;
  width: 16px;
  height: 16px;
  accent-color: var(--dsw-alias-brand-primary);
  cursor: pointer;
}
.bsp-actions{
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px 0 4px;
}
.bsp-button{
  min-height: 32px;
  padding: 0 14px;
  border: .5px solid var(--dsw-alias-border-l4);
  border-radius: var(--dsw-radius-md);
  background: var(--dsw-alias-bg-layer-3);
  color: var(--dsw-alias-label-primary);
  font-size: 13px;
  cursor: pointer;
}
.bsp-button:hover{ background-color: var(--dsw-alias-interactive-bg-hover); }
.bsp-button:focus-visible{
  outline: var(--dsw-focus-ring-width, 2px) solid
           var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: 1px;
}
.bsp-notice{
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-tertiary);
}
.bsp-note{
  margin: 12px 0 0;
  max-width: 64ch;
  font-size: 12px;
  line-height: 1.55;
  color: var(--dsw-alias-label-tertiary);
}
`.trim()
    //#endregion

    //#region dictionaries
    const ZH = {
      'section.nav': '设置页',
      'rail.expand': '展开分类栏',
      'rail.collapse': '收起分类栏',
      'page.title': '设置页外观',
      'page.intro': '这个插件只改设置页的呈现方式，不读也不写任何设置值。',
      'page.fullscreen': '全屏设置页',
      'page.fullscreenHint': '铺满整个窗口。桌面版会在顶部留出标题栏高度，那一条仍然可以拖动窗口。',
      'page.navCollapsed': '默认收起左侧分类栏',
      'page.navCollapsedHint': '收成 56px 图标栏，分类名保留给读屏。点右上角箭头可随时切换。',
      'page.reset': '恢复默认',
      'page.resetDone': '已恢复默认',
      'page.saveFailed': '浏览器拒绝保存（localStorage 已满或被禁用），这次改动没有生效。',
      'page.note': '这两项存在本机浏览器的 localStorage（键 dsh.better-setting-page.settings），换端口或清站点数据会丢。不认识的字段会原样保留。',
    }

    const EN = {
      'section.nav': 'Settings page',
      'rail.expand': 'Expand section list',
      'rail.collapse': 'Collapse section list',
      'page.title': 'Settings page appearance',
      'page.intro': 'This plugin only changes how the settings page is drawn. It reads and writes no setting of its own.',
      'page.fullscreen': 'Full-screen settings',
      'page.fullscreenHint': 'Fill the whole window. On desktop the title-bar height is kept as padding, and that strip still drags the window.',
      'page.navCollapsed': 'Collapse the section list by default',
      'page.navCollapsedHint': 'Shrinks the rail to a 56px icon column; section names stay in the accessibility tree. Toggle it any time with the arrow in the header.',
      'page.reset': 'Restore defaults',
      'page.resetDone': 'Defaults restored',
      'page.saveFailed': 'The browser refused to save this (localStorage full or blocked); the change did not stick.',
      'page.note': 'Both switches live in this browser profile’s localStorage (key dsh.better-setting-page.settings), so a different port or cleared site data resets them. Unknown fields are preserved as-is.',
    }
    //#endregion

    //#region settings store
    function isPlainObject(value) {
      return typeof value === 'object' && value !== null && !Array.isArray(value)
    }

    /**
     * Turn whatever was on disk into the exact shape this version understands.
     * Unknown top-level keys are carried in `unknown` so a downgrade or a future
     * version does not lose data the user (or a newer build) wrote.
     */
    function sanitizeSettings(raw) {
      const next = { version: SETTINGS_VERSION }
      const unknown = isPlainObject(raw) && isPlainObject(raw.unknown) ? { ...raw.unknown } : {}
      if (isPlainObject(raw)) {
        for (const key of Object.keys(raw)) {
          if (key === 'unknown' || key === 'version' || key in DEFAULTS) continue
          unknown[key] = raw[key]
        }
      }
      next.fullscreen = isPlainObject(raw) && typeof raw.fullscreen === 'boolean'
        ? raw.fullscreen
        : DEFAULTS.fullscreen
      next.navCollapsed = isPlainObject(raw) && typeof raw.navCollapsed === 'boolean'
        ? raw.navCollapsed
        : DEFAULTS.navCollapsed
      next.unknown = unknown
      return next
    }

    /** Last write/read problem, surfaced on the settings page. */
    let lastError = null

    function readSettings() {
      let raw = null
      try {
        const text = window.localStorage.getItem(STORE_KEY)
        if (typeof text === 'string' && text !== '') raw = JSON.parse(text)
        lastError = null
      } catch (error) {
        lastError = 'read'
        raw = null
      }
      return sanitizeSettings(raw)
    }

    function persist(settings) {
      try {
        window.localStorage.setItem(STORE_KEY, JSON.stringify(settings))
        lastError = null
      } catch (error) {
        lastError = 'write'
      }
    }

    let cache = null
    const listeners = new Set()

    function currentSettings() {
      if (cache === null) cache = readSettings()
      return cache
    }

    /**
     * Push a sanitized snapshot everywhere: disk, `<html>` attributes, listeners.
     * The `storage` event does not fire in the document that wrote it, so we
     * notify our own subscribers here instead of waiting for the event.
     */
    function commit(next) {
      cache = next
      persist(next)
      applyToDocument(next)
      for (const fn of listeners) fn(next)
      return next
    }

    function writeSettings(patch) {
      // Base the merge on what is on disk, not on the in-memory cache: another
      // window may have written unknown keys that this one has never seen, and
      // a patch must not drop them.
      const base = readSettings()
      const merged = isPlainObject(patch) ? { ...base, ...patch } : base
      return commit(sanitizeSettings(merged))
    }

    function resetSettings() {
      return writeSettings({
        fullscreen: DEFAULTS.fullscreen,
        navCollapsed: DEFAULTS.navCollapsed,
      })
    }

    function subscribeSettings(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    }

    /** The only DOM this plugin writes outside its own subtree. */
    function applyToDocument(settings) {
      if (typeof document === 'undefined') return
      const root = document.documentElement
      if (root === null || root === undefined) return
      root.setAttribute(FULLSCREEN_ATTR, settings.fullscreen === true ? 'on' : 'off')
      root.setAttribute(NAV_ATTR, settings.navCollapsed === true ? 'collapsed' : 'expanded')
    }

    function clearDocument() {
      if (typeof document === 'undefined') return
      const root = document.documentElement
      if (root === null || root === undefined) return
      root.removeAttribute(FULLSCREEN_ATTR)
      root.removeAttribute(NAV_ATTR)
    }

    /** Another window sharing this profile changed the settings. */
    function watchStorage() {
      const handler = (event) => {
        if (event.key !== null && event.key !== STORE_KEY) return
        const next = readSettings()
        cache = next
        applyToDocument(next)
        for (const fn of listeners) fn(next)
      }
      window.addEventListener('storage', handler)
      return () => window.removeEventListener('storage', handler)
    }

    function useSettings() {
      const [value, setValue] = React.useState(currentSettings)
      React.useEffect(() => {
        // A write can land between render and effect; resync once, then subscribe.
        setValue(currentSettings())
        return subscribeSettings(setValue)
      }, [])
      return value
    }
    //#endregion

    //#region components
    function translateOf(props) {
      return typeof props.t === 'function' ? props.t : (key) => key
    }

    /** Chevron, 14px, drawn by hand so a missing primitives module cannot break us. */
    function Chevron(props) {
      const pointsRight = props.direction === 'right'
      return h('svg', {
        width: 14,
        height: 14,
        viewBox: '0 0 16 16',
        fill: 'none',
        'aria-hidden': 'true',
        focusable: 'false',
      }, h('path', {
        d: pointsRight ? 'M6.25 3.5 10.75 8l-4.5 4.5' : 'M9.75 3.5 5.25 8l4.5 4.5',
        stroke: 'currentColor',
        strokeWidth: 1.5,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
      }))
    }

    /** `settings.action`: the rail toggle that sits left of the shipped buttons. */
    function RailToggle(props) {
      const t = translateOf(props)
      const settings = useSettings()
      const buttonRef = React.useRef(null)
      const ownedNavId = React.useRef(false)
      const [controls, setControls] = React.useState(NAV_ID)
      const collapsed = settings.navCollapsed === true

      React.useEffect(() => {
        // Lend the host's <nav> an id so aria-controls has something to point at.
        const button = buttonRef.current
        const panel = typeof button?.closest === 'function' ? button.closest(PANEL) : null
        const nav = panel === null ? null : panel.querySelector(':scope > nav')
        if (nav === null) return undefined
        if (nav.id === '') {
          nav.id = NAV_ID
          ownedNavId.current = true
          setControls(NAV_ID)
        } else {
          setControls(nav.id)
        }
        return () => {
          if (ownedNavId.current && nav.isConnected !== false) nav.removeAttribute('id')
        }
      }, [])

      const label = collapsed ? t('rail.expand') : t('rail.collapse')

      return h('button', {
        ref: buttonRef,
        type: 'button',
        className: 'bsp-rail-toggle',
        'aria-expanded': collapsed ? 'false' : 'true',
        'aria-controls': controls,
        'aria-label': label,
        title: label,
        onClick: () => {
          writeSettings({ navCollapsed: !collapsed })
        },
      }, h(Chevron, { direction: collapsed ? 'right' : 'left' }))
    }

    /** `settings.section.icon`: two panes, one narrow — the thing this plugin does. */
    function SectionIcon(props) {
      const size = typeof props.size === 'number' ? props.size : 16
      return h('svg', {
        width: size,
        height: size,
        viewBox: '0 0 16 16',
        fill: 'none',
        'aria-hidden': 'true',
        focusable: 'false',
      }, [
        h('rect', {
          key: 'frame',
          x: 2,
          y: 3,
          width: 12,
          height: 10,
          rx: 2,
          stroke: 'currentColor',
          strokeWidth: 1.3,
        }),
        h('path', {
          key: 'rail',
          d: 'M6.5 3v10',
          stroke: 'currentColor',
          strokeWidth: 1.3,
        }),
      ])
    }

    /** `settings.section`: the two switches plus "restore defaults". */
    function SettingsPage(props) {
      const t = translateOf(props)
      const settings = useSettings()
      const [notice, setNotice] = React.useState('')

      React.useEffect(() => {
        if (notice === '') return undefined
        const id = setTimeout(() => setNotice(''), 4000)
        return () => clearTimeout(id)
      }, [notice])

      /** Every write goes through here, so a failed write is never silent. */
      const write = (patch) => {
        writeSettings(patch)
        if (lastError === 'write') setNotice(t('page.saveFailed'))
      }

      const row = (titleKey, hintKey, checked, onToggle) => h('div', {
        key: titleKey,
        className: 'bsp-row',
      }, [
        h('div', { key: 'text', className: 'bsp-rowText' }, [
          h('div', { key: 'label', className: 'bsp-rowLabel' }, t(titleKey)),
          h('div', { key: 'hint', className: 'bsp-rowHint' }, t(hintKey)),
        ]),
        h('input', {
          key: 'check',
          type: 'checkbox',
          className: 'bsp-check',
          checked,
          'aria-label': t(titleKey),
          onChange: (event) => onToggle(event.target.checked),
        }),
      ])

      return h('div', { className: 'bsp-page' }, [
        h('div', { key: 'head', className: 'bsp-head' }, [
          h('h2', { key: 'title', className: 'bsp-title' }, t('page.title')),
          h('p', { key: 'intro', className: 'bsp-sub' }, t('page.intro')),
        ]),
        row('page.fullscreen', 'page.fullscreenHint', settings.fullscreen === true,
          (next) => write({ fullscreen: next })),
        row('page.navCollapsed', 'page.navCollapsedHint', settings.navCollapsed === true,
          (next) => write({ navCollapsed: next })),
        h('div', { key: 'actions', className: 'bsp-actions' }, [
          h('button', {
            key: 'reset',
            type: 'button',
            className: 'bsp-button',
            onClick: () => {
              resetSettings()
              setNotice(lastError === 'write' ? t('page.saveFailed') : t('page.resetDone'))
            },
          }, t('page.reset')),
          h('span', { key: 'notice', className: 'bsp-notice', role: 'status' }, notice),
        ]),
        h('p', { key: 'note', className: 'bsp-note' }, t('page.note')),
      ])
    }
    //#endregion

    //#region entry
    function apply(ctx) {
      const t = ctx.locale.bind(NS)
      cache = readSettings()
      applyToDocument(cache)

      ctx.effect(() => ctx.locale.register(NS, { zh: ZH, en: EN }), `${NS}: dictionaries`)

      ctx.effect(() => {
        const style = document.createElement('style')
        style.dataset.plugin = NS
        style.textContent = CSS
        document.head.appendChild(style)
        return () => {
          style.remove()
          clearDocument()
        }
      }, `${NS}: styles`)

      ctx.effect(() => subscribeSettings(applyToDocument), `${NS}: attributes`)
      ctx.effect(() => watchStorage(), `${NS}: storage`)

      ctx.slots.inject('settings.action', () => ctx.slots.register({
        name: 'settings.action',
        id: ACTION_ID,
        order: 0,
        locale: NS,
      }, (props) => h(RailToggle, { t })))

      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: SECTION_ID,
        order: SECTION_ORDER,
        label: () => t('section.nav'),
        locale: NS,
      }, (props) => h(SettingsPage, { close: props.close, t })))

      ctx.slots.inject('settings.section.icon', () => ctx.slots.register({
        name: 'settings.section.icon',
        id: SECTION_ID,
        order: SECTION_ORDER,
      }, SectionIcon))
    }

    const module = {
      inject: ['slots', 'locale'],
      apply,
      // Test surface. The loader only reads `apply` / `inject`; the rest exist so
      // `test/settings-page.test.mjs` can assert on the real strings and store.
      VERSION,
      NS,
      CSS,
      STORE_KEY,
      SETTINGS_VERSION,
      DEFAULTS,
      FULLSCREEN_ATTR,
      NAV_ATTR,
      NAV_ID,
      PANEL,
      SECTION_ID,
      SECTION_ORDER,
      ACTION_ID,
      ZH,
      EN,
      sanitizeSettings,
      readSettings,
      writeSettings,
      resetSettings,
      subscribeSettings,
      applyToDocument,
      clearDocument,
      currentSettings,
      lastErrorOf: () => lastError,
      RailToggle,
      SettingsPage,
      SectionIcon,
      Chevron,
    }
    return module
  },
})
