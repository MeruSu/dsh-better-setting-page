/**
 * Unit tests for `dsh-better-setting-page`.
 *
 * Same loading trick as `dsh-better-notice/test/classify.test.mjs`: stub
 * `window.__ModuleLoader__.load` to capture the factory, execute the real
 * `client.js` source with `new Function`, and assert on the exports. No bundler,
 * no jsdom, no React: `react` is replaced by a tiny recorder so the component
 * trees can be walked as plain objects.
 *
 * Everything here is pure logic over strings and shapes; whether the page really
 * fills the window is a machine check, not a unit test.
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(join(here, '..', 'client.js'), 'utf8')

/** The one anchor the host guarantees: the panel carries this attribute. */
const PANEL_SELECTOR = 'div[data-shortcut-modal="settings"]'

let groups = 0
const failures = []

function check(name, fn) {
  groups += 1
  try {
    fn()
    console.log(`ok ${groups} - ${name}`)
  } catch (error) {
    failures.push({ name, error })
    console.log(`not ok ${groups} - ${name}`)
    console.log(`  ${error && error.message}`)
  }
}

function equal(actual, expected, what) {
  if (actual !== expected) {
    throw new Error(`${what}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  }
}

function truthy(value, what) {
  if (!value) throw new Error(`${what}: expected truthy, got ${JSON.stringify(value)}`)
}

function has(haystack, needle, what) {
  if (!haystack.includes(needle)) throw new Error(`${what}: missing ${JSON.stringify(needle)}`)
}

function absent(haystack, needle, what) {
  if (haystack.includes(needle)) throw new Error(`${what}: unexpectedly found ${JSON.stringify(needle)}`)
}

//#region harness
/** Minimal React stand-in: enough to build and walk elements, no re-rendering. */
function fakeReact() {
  const effects = []
  return {
    effects,
    createElement(type, props, ...children) {
      const flat = []
      const push = (value) => {
        if (Array.isArray(value)) value.forEach(push)
        else if (value !== null && value !== undefined && value !== false) flat.push(value)
      }
      push(children)
      if (props && Object.prototype.hasOwnProperty.call(props, 'children')) push(props.children)
      return { type, props: { ...(props || {}), children: flat } }
    },
    useState(initial) {
      const value = typeof initial === 'function' ? initial() : initial
      return [value, () => {}]
    },
    useEffect(fn) {
      const cleanup = fn()
      if (typeof cleanup === 'function') effects.push(cleanup)
      return undefined
    },
    useRef(initial) {
      return { current: initial === undefined ? null : initial }
    },
  }
}

/** localStorage that can be told to throw, for the quota path. */
function fakeStorage(initial) {
  const map = new Map(Object.entries(initial || {}))
  let throwOnWrite = false
  let throwOnRead = false
  return {
    map,
    throwOnWrite(value) { throwOnWrite = value },
    throwOnRead(value) { throwOnRead = value },
    getItem(key) {
      if (throwOnRead) throw new Error('read blocked')
      return map.has(key) ? map.get(key) : null
    },
    setItem(key, value) {
      if (throwOnWrite) throw new Error('QuotaExceededError')
      map.set(key, String(value))
    },
    removeItem(key) { map.delete(key) },
  }
}

/** `<html>` recorder: the only document node this plugin touches. */
function fakeDocument() {
  const attrs = new Map()
  const styles = []
  return {
    attrs,
    styles,
    body: { appendChild() {}, removeChild() {} },
    documentElement: {
      setAttribute(name, value) { attrs.set(name, String(value)) },
      getAttribute(name) { return attrs.has(name) ? attrs.get(name) : null },
      removeAttribute(name) { attrs.delete(name) },
    },
    head: {
      appendChild(node) { styles.push(node); node.isConnected = true },
    },
    createElement(tag) {
      return { tagName: tag, dataset: {}, textContent: '', isConnected: false, remove() { this.isConnected = false } }
    },
    querySelector() { return null },
  }
}

/**
 * A nav stand-in: the host renders `<nav><div><button><span/><span/></button>…`.
 * Only the parts our code touches are modelled — attributes, text, click.
 */
function fakeNav(labels, currentIndex = -1) {
  const makeCell = (label, index) => {
    const attributes = new Map()
    if (index === currentIndex) attributes.set('aria-current', 'true')
    return {
      textContent: label,
      clicked: 0,
      setAttribute(name, value) { attributes.set(name, String(value)) },
      getAttribute(name) { return attributes.has(name) ? attributes.get(name) : null },
      removeAttribute(name) { attributes.delete(name) },
      click() { this.clicked += 1 },
      attributes,
    }
  }
  const cells = labels.map(makeCell)
  const nav = {
    cells,
    id: '',
    setAttribute() {},
    removeAttribute() {},
    querySelectorAll(selector) {
      if (selector === 'button') return cells.slice()
      const match = /\[([\w-]+)\]/.exec(selector)
      if (match === null) return []
      return cells.filter((cell) => cell.getAttribute(match[1]) !== null)
    },
    querySelector(selector) {
      if (selector === 'button[aria-current="true"]') {
        return cells.find((cell) => cell.getAttribute('aria-current') === 'true') || null
      }
      return null
    },
  }
  const panel = {
    nav,
    querySelector(selector) { return selector === ':scope > nav' ? nav : null },
  }
  return { nav, panel, cells }
}

/** A ctx whose slots answer the way the real registry does. */
function fakeSlotsCtx(options = {}) {
  const entries = options.entries || []
  const subscribers = []
  const actions = options.shellActions === undefined ? null : options.shellActions
  return {
    entries,
    subscribers,
    ctx: {
      slots: {
        entries(key) {
          equal(key, 'settings.section', 'collectSections reads the section slot')
          return entries
        },
        subscribe(key, fn) {
          subscribers.push({ key, fn })
          return () => {}
        },
        entriesOfSlot(key) {
          equal(key, 'sidebar.settings', 'shell handle is read from the shipped slot')
          if (actions === null) return []
          return [{ store: { create: () => ({ actions }) } }]
        },
      },
    },
    actions,
  }
}

/**
 * Load the real module once per test group so each starts from a clean store.
 * `captured` collects every slot registration the plugin makes.
 */
function load(options = {}) {
  const React = fakeReact()
  const storage = options.storage || fakeStorage()
  const document = options.document || fakeDocument()
  const listeners = []
  const captured = []
  const effects = []
  const localeDictionaries = []
  const registrySubscribers = []

  const window = {
    localStorage: storage,
    addEventListener(type, fn) { if (type === 'storage') listeners.push(fn) },
    removeEventListener(type, fn) {
      const index = listeners.indexOf(fn)
      if (index >= 0) listeners.splice(index, 1)
    },
    dispatchStorage(event) { for (const fn of listeners) fn(event) },
  }

  const sandboxRequire = (name) => {
    if (name === 'react') return React
    throw new Error(`unexpected require(${JSON.stringify(name)})`)
  }

  /** The loader stub also runs the factory, so the file is fully evaluated. */
  let mod = null
  window.__ModuleLoader__ = {
    load(entry) {
      equal(entry.id, 'dsh-better-setting-page', 'module id equals the package name')
      mod = entry.factory(sandboxRequire)
    },
  }

  new Function('window', 'document', 'require', source)(window, document, sandboxRequire)
  truthy(mod !== null, 'factory produced a module')

  const t = (key) => key
  const ctx = {
    locale: {
      bind(namespace) {
        equal(namespace, mod.NS, 'locale bind uses the plugin namespace')
        return t
      },
      register(namespace, dictionaries) {
        localeDictionaries.push({ namespace, dictionaries })
        return () => {}
      },
    },
    effect(fn, label) {
      const dispose = fn()
      effects.push({ label, dispose })
      return () => {}
    },
    slots: {
      inject(slotName, factory) {
        const dispose = factory()
        captured.push({ slotName, dispose })
        return () => {}
      },
      register(options, component) {
        captured.push({ options, component })
        return () => {}
      },
      // The registry the plugin reads its page list from. Default: only ourselves.
      entries(key) {
        equal(key, 'settings.section', 'entries() is asked for the section slot')
        if (options.entries !== undefined) return options.entries
        return [{ options: { id: mod.SECTION_ID, order: mod.SECTION_ORDER, label: () => 'section.nav' } }]
      },
      subscribe(key, fn) {
        equal(key, 'settings.section', 'subscribe() watches the section slot')
        registrySubscribers.push(fn)
        return () => {
          const index = registrySubscribers.indexOf(fn)
          if (index >= 0) registrySubscribers.splice(index, 1)
        }
      },
      entriesOfSlot(key) {
        equal(key, 'sidebar.settings', 'the shell handle is read from sidebar.settings')
        if (options.shellActions === undefined) return []
        return [{
          store: {
            create: () => ({ actions: options.shellActions }),
          },
        }]
      },
    },
  }

  mod.apply(ctx)

  return { mod, React, storage, document, listeners, captured, effects, localeDictionaries, window, t, ctx, registrySubscribers }
}
//#endregion

//#region 1. module shape
{
  const { mod } = load()
  check('exports apply and inject, and injects only slots + locale', () => {
    const SRC_VERSION = /const VERSION = '([^']+)'/.exec(source)[1]
    equal(typeof mod.apply, 'function', 'apply')
    equal(JSON.stringify(mod.inject), JSON.stringify(['slots', 'locale']), 'inject')
    equal(mod.VERSION, SRC_VERSION, 'version')
  })
  check('locale dictionaries ship zh and en with identical key sets', () => {
    const zh = Object.keys(mod.ZH).sort()
    const en = Object.keys(mod.EN).sort()
    equal(JSON.stringify(zh), JSON.stringify(en), 'zh/en key sets')
    truthy(zh.includes('rail.collapse'), 'has rail.collapse')
    truthy(zh.includes('page.fullscreen'), 'has page.fullscreen')
    truthy(zh.includes('page.reset'), 'has page.reset')
  })
}
//#endregion

//#region 2. slot registrations
{
  const { captured } = load()
  const registrations = captured.filter((item) => item.options !== undefined)
  check('registers the rail toggle on settings.action, never on settings.header', () => {
    const names = registrations.map((item) => item.options.name)
    truthy(names.includes('settings.action'), 'settings.action registered')
    absent(names.join(','), 'settings.header', 'settings.header must not be touched')
    const action = registrations.find((item) => item.options.name === 'settings.action')
    equal(action.options.id, 'better-setting-page.rail-toggle', 'action id (list slots require one)')
    equal(action.options.locale, 'better-setting-page', 'action locale so the slot injects t')
    equal(typeof action.options.label, 'undefined', 'no label on an icon button')
  })
  check('registers a section page and a matching nav icon', () => {
    const section = registrations.find((item) => item.options.name === 'settings.section')
    const icon = registrations.find((item) => item.options.name === 'settings.section.icon')
    truthy(section && icon, 'both slots registered')
    equal(section.options.id, 'better-setting-page', 'section id')
    equal(icon.options.id, 'better-setting-page', 'icon id must match the section id')
    equal(section.options.order, 50, 'section order')
    equal(typeof section.options.label, 'function', 'label must be a thunk, not a string')
    equal(section.options.label(), 'section.nav', 'thunk resolves through t')
  })
}
//#endregion

//#region 3. the stylesheet
{
  const { mod } = load()
  const css = mod.CSS
  check('anchors on the shipped panel attribute, not on hash class names', () => {
    has(css, 'div[data-shortcut-modal="settings"]', 'panel anchor')
    const hashClass = /\._?[A-Za-z0-9]{5,}_[A-Za-z0-9]{2,}_/.exec(css)
    if (hashClass !== null) throw new Error(`hash-like class name in CSS: ${hashClass[0]}`)
  })
  check('never uses !important', () => {
    absent(css, '!important', 'CSS')
  })
  check('fullscreen rules are gated on our own html attribute', () => {
    has(css, 'html[data-bsp-fullscreen="on"] div[data-shortcut-modal="settings"]', 'fullscreen rule')
    has(css, 'width: 100%', 'full width')
    has(css, 'height: 100%', 'full height')
    has(css, 'border-radius: 0', 'no panel radius')
    has(css, 'box-shadow: none', 'no panel shadow')
  })
  check('desktop title-bar height is given back as padding, with the web fallback', () => {
    has(css, 'var(--dsh-windows-titlebar-height', 'windows title-bar variable')
    has(css, 'var(--dsh-frame-top-clearance', 'frame clearance variable')
    has(css, 'padding-top: var(--bsp-top-pad)', 'padding applied')
    has(css, 'max(var(--dsh-windows-titlebar-height, 0px), var(--dsh-frame-top-clearance, 0px))', 'max() of both')
  })
  check('the mask keeps its hit area: no display:none, no pointer-events:none on it', () => {
    const maskRule = /html\[data-bsp-fullscreen="on"\] div:has\(> div\[data-shortcut-modal="settings"\]\) > div:first-child\{([^}]*)\}/.exec(css)
    truthy(maskRule, 'mask rule present')
    absent(maskRule[1], 'display', 'mask rule must not touch display')
    absent(maskRule[1], 'pointer-events', 'mask rule must not touch pointer-events')
    has(maskRule[1], 'background: transparent', 'mask paints nothing')
    has(maskRule[1], 'backdrop-filter: none', 'mask blurs nothing')
    // display:none exists in exactly one rule now (the hidden nav row), and it is
    // not this one. Anything else using it is the click-outside bug coming back.
    const hiding = css.split('display: none').length - 1
    equal(hiding, 1, 'exactly one display:none in the whole stylesheet')
    has(css, '[data-bsp-hidden="1"]', 'and it belongs to the hidden nav row')
    absent(css, 'pointer-events: none', 'no pointer-events:none anywhere')  })
  check('the header row is matched by descendant, because data-slot sits inside .actions', () => {
    // The header *padding* rule must reach .header, which is the slot outlet's
    // grandparent: a direct-child form there would style .actions instead.
    const paddingRule = /html\[data-bsp-fullscreen="on"\] div\[data-shortcut-modal="settings"\][^{]*\{[^}]*padding-right: 26px[^}]*\}/.exec(css)
    truthy(paddingRule, 'header padding rule present')
    has(paddingRule[0], '> div:has([data-slot="settings.action"])', 'descendant form for the header row')
    absent(paddingRule[0], '> div:has(> [data-slot="settings.action"])', 'direct-child form would match .actions, not .header')
    // The direct-child form is legal only where .actions itself is the target:
    // flattening it so the toggle becomes a header flex item.
    const flatten = /div\[data-shortcut-modal="settings"\] > div:has\(\[data-slot="settings\.action"\]\) > div:has\(> \[data-slot="settings\.action"\]\)\{([^}]*)\}/.exec(css)
    truthy(flatten, 'flatten rule for .actions present')
    has(flatten[1], 'display: contents', 'flattens the wrapper without removing it')
    has(css, '> div:has(> [data-slot="settings.section"])', 'content column is the direct parent')
  })
  check('collapsing changes grid columns only, and hides labels accessibly', () => {
    has(css, 'grid-template-columns: 56px minmax(0, 1fr)', 'collapsed columns')
    has(css, '@media (min-width: 768px)', 'narrow screens are left to the host')
    has(css, 'clip-path: inset(50%)', 'visually-hidden utility')
    has(css, 'position: absolute', 'clip needs positioning to take effect')
    absent(css, 'grid-template-areas', 'area names are host hashes')
    absent(css, 'grid-template:', 'shorthand would reset the host area names')
  })
  check('content column gets min-height so the scroll container can shrink', () => {
    has(css, 'min-height: 0', 'min-height')
    has(css, 'max-width: 880px', 'readable line length')
  })
  check('the drag strip is only created on desktop platforms', () => {
    has(css, 'html[data-windows-titlebar][data-bsp-fullscreen="on"]', 'windows gate')
    has(css, 'html[data-platform="darwin"][data-bsp-fullscreen="on"]', 'darwin gate')
    has(css, '-webkit-app-region: drag', 'drag strip')
  })
}

//#region 3b. header layout: collapse on the left, exit on the right
{
  const { mod } = load()
  const css = mod.CSS
  check('the toggle reaches the top-left corner by flattening its two wrappers', () => {
    // `order` cannot do this job: the toggle is a grandchild of the header
    // (header > .actions > [data-slot] > button), so order would only reorder it
    // inside .actions. Both wrapper levels have to stop generating boxes.
    const flattenActions = /div\[data-shortcut-modal="settings"\] > div:has\(\[data-slot="settings\.action"\]\) > div:has\(> \[data-slot="settings\.action"\]\)\{([^}]*)\}/.exec(css)
    truthy(flattenActions, 'flattens .actions')
    has(flattenActions[1], 'display: contents', '.actions must not generate a box')
    const flattenOutlet = /div\[data-shortcut-modal="settings"\] > div:has\(\[data-slot="settings\.action"\]\) > div:has\(> \[data-slot="settings\.action"\]\) > \[data-slot="settings\.action"\]\{([^}]*)\}/.exec(css)
    truthy(flattenOutlet, 'restates the outlet flattening')
    has(flattenOutlet[1], 'display: contents', 'the outlet must not generate a box either')
    // With both boxes gone the toggle is a flex item of the header. It is still
    // not necessarily the *first* one: registration order differs between builds
    // (browser puts ours first, the desktop shell puts the shipped actions
    // first), so the position must come from `order`, and the auto margin then
    // pushes every shipped button to the right of it.
    const toggle = /div\[data-shortcut-modal="settings"\] \[data-slot="settings\.action"\] > \.bsp-rail-toggle\{([^}]*)\}/.exec(css)
    truthy(toggle, 'toggle layout rule present')
    has(toggle[1], 'order: -1', 'toggle claims the visual start regardless of registration order')
    has(toggle[1], 'margin-right: auto', 'toggle sits left, shipped buttons sit right')
  })
  check('the shipped close button is restyled, never moved or replaced', () => {
    const close = 'div[data-shortcut-modal="settings"] > div:has([data-slot="settings.action"]) > button:last-of-type'
    has(css, close, 'addressed at the header level as last-of-type')
    const rules = css.replace(/\/\*[\s\S]*?\*\//g, '')
    absent(rules, 'settings.close', 'must not touch the close slot that carries the accessible name')
    absent(rules, 'aria-label', 'the accessible name stays the host copy')
    absent(rules, 'pointer-events: none', 'the button must stay clickable')
    // The glyph swap must not delete the node: the shipped svg stays in the tree,
    // only out of flow and invisible. display:none is allowed in exactly one place
    // in this stylesheet (the hidden nav row); it must never reach this button.
    const hideRules = rules.match(/[^{}]*\{[^}]*display: none[^}]*\}/g) || []
    equal(hideRules.length, 1, 'only one rule hides anything at all')
    has(hideRules[0], '[data-bsp-hidden="1"]', 'and it is the hidden nav row, not the close button')
    absent(hideRules[0], 'last-of-type', 'the close button is never display:none')
    const hideSvg = /button:last-of-type > svg\{([^}]*)\}/.exec(css)
    truthy(hideSvg, 'rule for the shipped glyph')
    has(hideSvg[1], 'visibility: hidden', 'glyph hidden without being removed')
    has(hideSvg[1], 'position: absolute', 'and takes no room next to the arrow')
  })
  check('the close glyph becomes a return arrow drawn as a mask', () => {
    const after = /button:last-of-type::after\{([^}]*)\}/.exec(css)
    truthy(after, 'arrow rule present')
    has(after[1], 'background-color: currentColor', 'arrow follows the host theme')
    has(after[1], 'mask: var(--bsp-return-icon)', 'masked with the inline svg')
    has(after[1], 'width: 14px', 'matches the shipped icon box')
    has(after[1], 'height: 14px', 'matches the shipped icon box')
    const def = /button:last-of-type\{\s*\n?\s*--bsp-return-icon: url\("data:image\/svg\+xml/.exec(css)
    truthy(def, 'the icon is defined on the button itself, so no ungated panel rule is needed')
    // A text glyph would render differently per font; the arrow must be a path.
    has(css, "data:image/svg+xml", 'arrow is an inline svg, not a character')
    has(css, "stroke-linecap='round'", 'rounded strokes match the shipped icon style')
  })
}
//#endregion

//#region 4. store
{
  const { mod, storage } = load()
  check('defaults are full-screen on, rail expanded', () => {
    const defaults = mod.DEFAULTS
    equal(defaults.fullscreen, true, 'fullscreen default')
    equal(defaults.navCollapsed, false, 'navCollapsed default')
    equal(defaults.version, 1, 'version default')
  })
  check('storage key is namespaced and stable', () => {
    equal(mod.STORE_KEY, 'dsh.better-setting-page.settings', 'key')
    equal(mod.SETTINGS_VERSION, 1, 'settings version')
  })
  check('a missing or broken record falls back to defaults', () => {
    const fresh = mod.readSettings()
    equal(fresh.fullscreen, true, 'missing record → default fullscreen')
    storage.map.set(mod.STORE_KEY, '{not json')
    const broken = mod.readSettings()
    equal(broken.fullscreen, true, 'broken JSON → default')
    storage.map.set(mod.STORE_KEY, JSON.stringify({ fullscreen: 'yes', navCollapsed: 1 }))
    const wrongTypes = mod.readSettings()
    equal(wrongTypes.fullscreen, true, 'non-boolean fullscreen → default')
    equal(wrongTypes.navCollapsed, false, 'non-boolean navCollapsed → default')
  })
  check('unknown keys survive a read/write round trip', () => {
    storage.map.set(mod.STORE_KEY, JSON.stringify({ fullscreen: false, futureThing: { a: 1 } }))
    const read = mod.readSettings()
    equal(read.fullscreen, false, 'known key read')
    equal(JSON.stringify(read.unknown.futureThing), JSON.stringify({ a: 1 }), 'unknown key kept')
    mod.writeSettings({ navCollapsed: true })
    const stored = JSON.parse(storage.map.get(mod.STORE_KEY))
    equal(stored.navCollapsed, true, 'written key')
    equal(JSON.stringify(stored.unknown.futureThing), JSON.stringify({ a: 1 }), 'unknown key still on disk')
  })
  check('writeSettings notifies subscribers synchronously (storage events do not fire in this document)', () => {
    const seen = []
    const stop = mod.subscribeSettings((next) => seen.push(next.navCollapsed))
    mod.writeSettings({ navCollapsed: true })
    mod.writeSettings({ navCollapsed: false })
    stop()
    mod.writeSettings({ navCollapsed: true })
    equal(JSON.stringify(seen), JSON.stringify([true, false]), 'notified twice, then unsubscribed')
  })
  check('a quota failure still notifies and records the error', () => {
    storage.map.clear()
    const seen = []
    const stop = mod.subscribeSettings((next) => seen.push(next.fullscreen))
    storage.throwOnWrite(true)
    mod.writeSettings({ fullscreen: false })
    storage.throwOnWrite(false)
    stop()
    equal(seen.length, 1, 'listener still ran')
    equal(mod.lastErrorOf(), 'write', 'error recorded')
    equal(storage.map.get(mod.STORE_KEY), undefined, 'nothing on disk')
  })
  check('reset restores both defaults and keeps unknown keys', () => {
    storage.map.set(mod.STORE_KEY, JSON.stringify({ fullscreen: false, navCollapsed: true, keepMe: 7 }))
    mod.writeSettings({ fullscreen: false })
    const after = mod.resetSettings()
    equal(after.fullscreen, true, 'fullscreen back to default')
    equal(after.navCollapsed, false, 'navCollapsed back to default')
    equal(after.unknown.keepMe, 7, 'unknown key kept through reset')
  })
  check('html attributes mirror the settings and are removed on unload', () => {
    const { mod: fresh, document } = load()
    equal(document.attrs.get(fresh.FULLSCREEN_ATTR), 'on', 'fullscreen attribute')
    equal(document.attrs.get(fresh.NAV_ATTR), 'expanded', 'nav attribute')
    fresh.writeSettings({ fullscreen: false, navCollapsed: true })
    equal(document.attrs.get(fresh.FULLSCREEN_ATTR), 'off', 'toggled off')
    equal(document.attrs.get(fresh.NAV_ATTR), 'collapsed', 'collapsed')
    fresh.clearDocument()
    equal(document.attrs.has(fresh.FULLSCREEN_ATTR), false, 'fullscreen attribute removed')
    equal(document.attrs.has(fresh.NAV_ATTR), false, 'nav attribute removed')
  })
  check('a cross-window storage event is applied and broadcast', () => {
    const { mod: fresh, storage, window, document } = load()
    const seen = []
    fresh.subscribeSettings((next) => seen.push(next.fullscreen))
    storage.map.set(fresh.STORE_KEY, JSON.stringify({ fullscreen: false, navCollapsed: true }))
    window.dispatchStorage({ key: fresh.STORE_KEY })
    equal(seen.length, 1, 'subscriber notified')
    equal(document.attrs.get(fresh.FULLSCREEN_ATTR), 'off', 'attribute followed the event')
  })
  check('the UIC stand-down is gone: no probe, no guard, no "managed by" copy', () => {
    const { mod } = load()
    equal(mod.uicPresenceOf, undefined, 'the presence probe is no longer exported')
    equal(mod.UIC_SECTION_ID, undefined, 'nor the section id it matched on')
    equal(mod.UIC_PANEL_ATTR, undefined, 'nor the panel attribute it guarded on')
    equal('page.navCollapsedManaged' in mod.ZH, false, 'ZH dropped the "managed by" hint')
    equal('page.navCollapsedManaged' in mod.EN, false, 'EN dropped the "managed by" hint')
  })
  check('the stylesheet no longer guards the collapse rules on data-uic-nav', () => {
    const { mod } = load()
    // The guard existed so the UIC's expanded state could win over our 56px
    // track. Nothing declares that attribute any more, and keeping the guard
    // would silently disable collapsing in any profile where a stale UIC build
    // still stamps it.
    equal(mod.CSS.includes('data-uic-nav'), false, 'no data-uic-nav anywhere in the CSS')
    equal(mod.CSS.includes(':not([data-uic-nav])'), false, 'no :not() stand-down guard left')
    truthy(mod.CSS.includes('html[data-bsp-nav="collapsed"] div[data-shortcut-modal="settings"]'),
      'the collapse rules still key off our own attribute')
    equal(mod.CSS.split('html[data-bsp-nav="collapsed"]').length - 1, 5,
      'all five collapse rules survived, unguarded')
  })
  check('REGRESSION TRAP: with the UIC installed the collapse row must still work', () => {
    // 0.1.5 stood down whenever a `ui-controller` section was in the registry: it
    // stopped writing data-bsp-nav, suppressed the header chevron, and disabled
    // this row with a hint pointing at the UIC's three states. The UIC then
    // dropped those states, so the stand-down left the rail owned by nobody —
    // the switch rendered greyed and did nothing in every profile that had both.
    // These assertions fail the moment that stand-down comes back.
    const { mod, document } = load({
      entries: [
        { options: { id: 'ui-controller', order: 40, label: () => 'UI' } },
        { options: { id: 'better-setting-page', order: 50, label: () => 'section.nav' } },
      ],
    })
    equal(document.attrs.get(mod.NAV_ATTR), 'expanded', 'the nav attribute is written with the UIC around')
    mod.writeSettings({ navCollapsed: true })
    equal(document.attrs.get(mod.NAV_ATTR), 'collapsed', 'and it follows the switch')
    const toggle = mod.RailToggle({ t: (key) => key })
    truthy(toggle !== null && toggle !== undefined, 'the header chevron is rendered, not suppressed')
    equal(toggle.props.className, 'bsp-rail-toggle', 'and it is still our toggle')
    const page = mod.SettingsPage({ t: (key) => key })
    const row = page.props.children.filter((node) => node && node.props && node.props.className === 'bsp-row')[1]
    const box = row.props.children.find((child) => child && child.type === 'input')
    equal(box.props.disabled, undefined, 'the row is enabled, not greyed out')
    equal(String(row.props.children[0].props.children[1].props.children), 'page.navCollapsedHint',
      'the hint is ours again, not the "managed by" text')
  })
  check('without the UIC, data-bsp-nav is still written as before', () => {
    const { mod, document } = load()
    equal(document.attrs.get(mod.NAV_ATTR), 'expanded', 'expanded written when the UIC is absent')
    mod.writeSettings({ navCollapsed: true })
    equal(document.attrs.get(mod.NAV_ATTR), 'collapsed', 'collapsed written when the UIC is absent')
  })
}
//#endregion

//#region 5. wiring
{
  const { mod, document, effects, localeDictionaries, React } = load()
  check('apply injects exactly one stylesheet tagged with the plugin name', () => {
    equal(document.styles.length, 1, 'one <style>')
    equal(document.styles[0].dataset.plugin, mod.NS, 'tagged with the namespace')
    has(document.styles[0].textContent, 'data-shortcut-modal="settings"', 'stylesheet carries the rules')
  })
  check('apply registers the dictionaries and every effect has a disposer', () => {
    equal(localeDictionaries.length, 1, 'one register call (a second one throws in the host)')
    equal(localeDictionaries[0].namespace, mod.NS, 'namespace')
    truthy(effects.length >= 4, 'styles + attributes + storage + dictionaries')
    for (const entry of effects) {
      truthy(typeof entry.dispose === 'function', `effect ${entry.label} has a disposer`)
    }
  })
  check('the toggle button renders as a real button with the ARIA contract', () => {
    const tree = mod.RailToggle({ t: (key) => key })
    equal(tree.type, 'button', 'element type')
    equal(tree.props.type, 'button', 'type attribute')
    equal(tree.props.className, 'bsp-rail-toggle', 'class')
    equal(tree.props['aria-expanded'], 'true', 'expanded when the rail is expanded')
    equal(tree.props['aria-controls'], mod.NAV_ID, 'points at the nav id')
    equal(tree.props['aria-label'], 'rail.collapse', 'label names the action')
    equal(tree.props.title, 'rail.collapse', 'title matches the label')
    equal(tree.props['data-modal-autofocus'], undefined, 'must not steal initial focus')
    void React
  })
  check('the settings page renders two switches and a restore button', () => {
    const tree = mod.SettingsPage({ t: (key) => key })
    const rows = tree.props.children.filter((node) => node && node.props && node.props.className === 'bsp-row')
    equal(rows.length, 2, 'two rows')
    const boxes = rows.map((row) => row.props.children.find((child) => child && child.type === 'input'))
    equal(boxes.length, 2, 'two checkboxes')
    for (const box of boxes) {
      equal(box.props.type, 'checkbox', 'checkbox input')
      truthy(typeof box.props.onChange === 'function', 'checkbox is wired')
      truthy(typeof box.props['aria-label'] === 'string' && box.props['aria-label'].length > 0, 'checkbox has a name')
    }
    const actions = tree.props.children.find((node) => node && node.props && node.props.className === 'bsp-actions')
    const buttons = actions.props.children.filter((node) => node && node.type === 'button')
    equal(buttons.length, 1, 'one button')
    equal(buttons[0].props.className, 'bsp-button', 'button styled by us, not by a host class')
    truthy(typeof buttons[0].props.onClick === 'function', 'restore is wired')
  })
  check('props.t is used when the host injects one, and never assumed', () => {
    const tree = mod.RailToggle({ t: (key) => `T:${key}` })
    equal(tree.props['aria-label'], 'T:rail.collapse', 'translated label')
    const bare = mod.RailToggle({})
    equal(bare.props['aria-label'], 'rail.collapse', 'falls back to the key when t is absent')
  })
  check('a refused write is surfaced instead of silently reverting the switch', () => {
    const { mod: fresh, storage } = load()
    storage.throwOnWrite(true)
    const tree = fresh.SettingsPage({ t: (key) => key })
    const row = tree.props.children.filter((node) => node && node.props && node.props.className === 'bsp-row')[0]
    const box = row.props.children.find((child) => child && child.type === 'input')
    box.props.onChange({ target: { checked: false } })
    equal(fresh.lastErrorOf(), 'write', 'the failure is recorded')
    truthy(Object.keys(fresh.ZH).includes('page.saveFailed'), 'and there is a message for it')
  })
}
//#endregion

//#region 6. must-fail guard (lead's regression trap)
{
  check('REGRESSION TRAP: header selector must stay a descendant match', () => {
    const { mod } = load()
    // If someone "simplifies" this back to a direct child, the rule silently
    // styles `.actions` instead of `.header` and the fullscreen padding never
    // lands. This assertion is written to fail in exactly that case.
    const wrong = 'div[data-shortcut-modal="settings"] > div:has(> [data-slot="settings.action"])'
    if (mod.CSS.includes(wrong)) {
      throw new Error('header padding went back to the direct-child selector: it matches .actions, not .header')
    }
    truthy(mod.CSS.includes('> div:has([data-slot="settings.action"])'), 'descendant form present')
  })
  check('REGRESSION TRAP: fullscreen must stay gated on our own attribute', () => {
    const { mod } = load()
    if (!mod.CSS.includes('html[data-bsp-fullscreen="on"] div[data-shortcut-modal="settings"]')) {
      throw new Error('fullscreen rules are no longer gated on html[data-bsp-fullscreen="on"]')
    }
    const ungated = /(^|\n)div\[data-shortcut-modal="settings"\]\{/.test(mod.CSS)
    if (ungated) throw new Error('there is an ungated panel rule: it would apply even with fullscreen off')
  })
}
//#endregion

//#region 7. hidden pages
/**
 * The feature's own invariant, and the reason it is safe: the list of pages comes
 * from the slot registry (never from the DOM, which is empty on a cold start), an
 * id is only ever hidden after we marked the row ourselves, and our own page can
 * never enter the list — hiding it would delete the only door back in.
 */
{
  const { mod } = load()
  check('the hidden list keeps strings, drops duplicates and our own page', () => {
    const clean = mod.sanitizeHidden([
      'models', 'models', '  agents  ', '', 42, null, undefined, mod.SECTION_ID, 'models',
    ])
    equal(JSON.stringify(clean), JSON.stringify(['models', 'agents']), 'trimmed, deduped, self excluded')
    equal(JSON.stringify(mod.sanitizeHidden('models')), JSON.stringify([]), 'a non-array is not a crash')
    equal(JSON.stringify(mod.sanitizeHidden(null)), JSON.stringify([]), 'null is not a crash')
  })
  check('the list is capped so a corrupt value cannot grow without bound', () => {
    const many = []
    for (let index = 0; index < mod.HIDDEN_MAX + 20; index += 1) many.push('page-' + index)
    equal(mod.sanitizeHidden(many).length, mod.HIDDEN_MAX, 'capped at HIDDEN_MAX')
  })
  check('hidden ids survive a read/write round trip, unknown keys still ride along', () => {
    const { mod: fresh, storage } = load()
    fresh.writeSettings({ hidden: ['models', 'agents'], keepMe: { deep: true } })
    const raw = JSON.parse(storage.map.get(fresh.STORE_KEY))
    equal(JSON.stringify(raw.hidden), JSON.stringify(['models', 'agents']), 'written to disk')
    equal(JSON.stringify(raw.unknown.keepMe), JSON.stringify({ deep: true }), 'unknown key preserved')
    equal(JSON.stringify(fresh.readSettings().hidden), JSON.stringify(['models', 'agents']), 'read back')
    fresh.writeSettings({ hidden: ['models', fresh.SECTION_ID] })
    equal(JSON.stringify(fresh.readSettings().hidden), JSON.stringify(['models']), 'self never lands on disk')
  })
  check('restore defaults clears the hidden list too', () => {
    const { mod: fresh } = load()
    fresh.writeSettings({ hidden: ['models'] })
    fresh.resetSettings()
    equal(JSON.stringify(fresh.readSettings().hidden), JSON.stringify([]), 'list cleared')
  })
  check('the page list comes from the registry, not from the radio of a mounted nav', () => {
    const entries = [
      { options: { id: 'models', order: 10, label: () => 'Models' } },
      { options: { id: 'agents', order: 20, label: 'Agents' } },
      { options: { id: 'throws', order: 30, label: () => { throw new Error('boom') } } },
      { options: { id: '', order: 40, label: 'nameless' } },
      { options: {} },
    ]
    const { ctx } = fakeSlotsCtx({ entries })
    const list = mod.collectSections(ctx)
    equal(list.map((row) => row.id).join(','), 'models,agents,throws', 'ids in order, nameless dropped')
    equal(list[0].label, 'Models', 'thunk labels are resolved')
    equal(list[1].label, 'Agents', 'plain labels pass through')
    equal(list[2].label, '', 'a throwing thunk degrades to an empty label, not a crash')
    equal(mod.collectSections(undefined).length, 0, 'no ctx is not a crash')
  })
  check('nav rows are marked with their section id, by label first then by position', () => {
    // Position fallback is what matters when a label was re-worded by i18n:
    // the third cell must still be our own page, never a neighbour's.
    const entries = [
      { options: { id: 'models', order: 10, label: () => 'Models' } },
      { options: { id: 'agents', order: 20, label: () => 'Agents' } },
      { options: { id: mod.SECTION_ID, order: 50, label: () => 'Settings page' } },
    ]
    const sections = mod.collectSections(fakeSlotsCtx({ entries }).ctx)
    equal(sections.map((row) => row.id).join(','), 'models,agents,better-setting-page', 'registry order')
    equal(sections[2].id, mod.SECTION_ID, 'position matches the shell sort')
  })
  check('opening a page goes through the shell store and refuses nonsense', () => {
    const calls = []
    const actions = {
      openSection(id) { calls.push(id) },
      select(id) { calls.push('select:' + id) },
    }
    const { ctx } = fakeSlotsCtx({ shellActions: actions })
    equal(mod.openSection(ctx, 'models'), true, 'a real id is dispatched')
    equal(JSON.stringify(calls), JSON.stringify(['models']), 'openSection is the action used')
    equal(mod.openSection(ctx, mod.SECTION_ID), false, 'our own page is never a target')
    equal(mod.openSection(ctx, ''), false, 'an empty id is refused')
    const noStore = fakeSlotsCtx({})
    equal(mod.openSection(noStore.ctx, 'models'), true, 'still returns true and falls back to the DOM path')
  })
  check('the shell actions are read from the shipped sidebar.settings handle', () => {
    const actions = { openSection() {} }
    const { ctx } = fakeSlotsCtx({ shellActions: actions })
    equal(mod.shellActionsOf(ctx), actions, 'handle → store → create() → actions')
    equal(mod.shellActionsOf(fakeSlotsCtx({}).ctx), null, 'no handle means null, not a throw')
    equal(mod.shellActionsOf(undefined), null, 'no ctx means null, not a throw')
  })
}
//#endregion

//#region 8. hidden pages: the page UI
{
  const entries = [
    { options: { id: 'models', order: 10, label: () => 'Models' } },
    { options: { id: 'agents', order: 20, label: () => 'Agents' } },
    { options: { id: 'better-setting-page', order: 50, label: () => 'Settings page' } },
  ]
  const { mod, ctx } = load({ entries })
  mod.writeSettings({ hidden: ['models'] })
  const tree = mod.SettingsPage({ t: (key) => key, ctx })
  const live = mod.readSettings()

  check('every page is listed, including the hidden one', () => {
    const list = tree.props.children.find((node) => node && node.props && node.props.className === 'bsp-sections')
    truthy(list, 'sections block rendered')
    const rows = list.props.children.filter((node) => node && node.props && node.props.className === 'bsp-sectionRow')
    equal(rows.length, 3, 'one row per page in the registry')
    const ids = rows.map((row) => row.props['data-bsp-section'])
    equal(ids.join(','), 'models,agents,better-setting-page', 'registry order')
    equal(rows[0].props['data-bsp-section-hidden'], '1', 'the hidden page is flagged')
    equal(rows[1].props['data-bsp-section-hidden'], '0', 'the visible page is not')
  })
  check('the hidden page can still be opened from the list', () => {
    const calls = []
    const actions = { openSection(id) { calls.push(id) } }
    const { mod: fresh, ctx: withShell } = load({ entries, shellActions: actions })
    fresh.writeSettings({ hidden: ['models'] })
    const page = fresh.SettingsPage({ t: (key) => key, ctx: withShell })
    const list = page.props.children.find((node) => node && node.props && node.props.className === 'bsp-sections')
    const rows = list.props.children.filter((node) => node && node.props && node.props.className === 'bsp-sectionRow')
    const link = rows[0].props.children.find((node) => node && node.props && node.props.className === 'bsp-sectionLink')
    truthy(typeof link.props.onClick === 'function', 'the name is a button')
    link.props.onClick()
    equal(JSON.stringify(calls), JSON.stringify(['models']), 'clicking the hidden page asks the shell to open it')
    equal(link.props['aria-disabled'], undefined, 'a hidden page is not disabled: it must stay reachable')
  })
  check('our own page is listed read-only, with no checkbox', () => {
    const list = tree.props.children.find((node) => node && node.props && node.props.className === 'bsp-sections')
    const rows = list.props.children.filter((node) => node && node.props && node.props.className === 'bsp-sectionRow')
    const self = rows[2]
    const box = self.props.children.find((node) => node && node.type === 'input')
    equal(box, undefined, 'no checkbox on our own row')
    const link = self.props.children.find((node) => node && node.props && node.props.className === 'bsp-sectionLink')
    equal(link.props['aria-disabled'], 'true', 'and it is not clickable')
  })
  check('the checkbox writes the id into the hidden list and can undo it', () => {
    const list = tree.props.children.find((node) => node && node.props && node.props.className === 'bsp-sections')
    const rows = list.props.children.filter((node) => node && node.props && node.props.className === 'bsp-sectionRow')
    const boxOf = (row) => row.props.children.find((node) => node && node.type === 'input')
    // models is hidden already: clearing it must remove the id, not add another.
    boxOf(rows[0]).props.onChange({ target: { checked: false } })
    equal(JSON.stringify(mod.readSettings().hidden), JSON.stringify([]), 'unhidden')
    // agents is visible: checking it must append.
    boxOf(rows[1]).props.onChange({ target: { checked: true } })
    equal(JSON.stringify(mod.readSettings().hidden), JSON.stringify(['agents']), 'hidden')
    // Toggling twice must not duplicate the id: the sanitizer collapses it, so a
    // double-click or two windows writing the same id cannot grow the list.
    boxOf(rows[1]).props.onChange({ target: { checked: true } })
    equal(JSON.stringify(mod.readSettings().hidden), JSON.stringify(['agents']), 'idempotent')
  })
  check('the page renders the same with an empty registry and with no ctx at all', () => {
    const { mod: bare, ctx: emptyCtx } = load({ entries: [] })
    const page = bare.SettingsPage({ t: (key) => key, ctx: emptyCtx })
    const list = page.props.children.find((node) => node && node.props && node.props.className === 'bsp-sections')
    const rows = list.props.children.filter((node) => node && node.props && node.props.className === 'bsp-sectionRow')
    equal(rows.length, 0, 'no rows')
    const note = list.props.children.find((node) => node && node.props && node.props.className === 'bsp-sub'
      && String(node.props.children).includes('pages.empty'))
    truthy(note, 'an empty-registry message instead of a blank block')
    const noCtx = bare.SettingsPage({ t: (key) => key })
    truthy(noCtx.props.children.length > 0, 'rendering without ctx does not throw')
  })
}
//#endregion

//#region 9. hidden rows: stylesheet and nav marking
{
  check('the hide rule can only reach a nav row we marked ourselves', () => {
    const { mod } = load()
    const rules = mod.CSS.match(/[^{}]*\{[^}]*display: none[^}]*\}/g) || []
    equal(rules.length, 1, 'exactly one hiding rule')
    has(rules[0], 'div[data-shortcut-modal="settings"] nav [data-bsp-hidden="1"]', 'scoped to the settings nav')
    has(mod.CSS, '[aria-current="true"]', 'the current row stays addressable, so a hidden page can become current')
  })
  check('marking writes the id onto the row, and hiding touches only marked rows', () => {
    // The module closes over `document`, so this group re-evaluates the source with
    // a fake document that exposes a nav, instead of monkey-patching a global.
    const { panel, cells } = fakeNav(['Models', 'Agents', 'Settings page'])
    const document = fakeDocument()
    document.querySelector = (selector) => (selector === PANEL_SELECTOR ? panel : null)
    const React = fakeReact()
    const window = {
      localStorage: fakeStorage(),
      addEventListener() {},
      removeEventListener() {},
    }
    let mod = null
    window.__ModuleLoader__ = { load(entry) { mod = entry.factory(() => React) } }
    new Function('window', 'document', 'require', source)(window, document, () => React)
    equal(mod.markNavRows([
      { id: 'models', order: 10, label: 'Models' },
      { id: 'agents', order: 20, label: 'Agents' },
      { id: mod.SECTION_ID, order: 50, label: 'Settings page' },
    ]), 3, 'all three rows marked')
    equal(cells[0].getAttribute(mod.NAV_ID_ATTR), 'models', 'first row id')
    equal(cells[1].getAttribute(mod.NAV_ID_ATTR), 'agents', 'second row id')
    equal(cells[2].getAttribute(mod.NAV_ID_ATTR), mod.SECTION_ID, 'third row id')
    equal(mod.applyHiddenRows(['agents']), 1, 'one row hidden')
    equal(cells[0].getAttribute(mod.HIDDEN_ATTR), null, 'unmarked row untouched')
    equal(cells[1].getAttribute(mod.HIDDEN_ATTR), '1', 'marked row hidden')
    equal(cells[2].getAttribute(mod.HIDDEN_ATTR), null, 'our own page never hidden')
    equal(mod.applyHiddenRows([]), 0, 'clearing removes the marker')
    equal(cells[1].getAttribute(mod.HIDDEN_ATTR), null, 'marker gone')
  })
  check('the nav sync marks rows and applies the stored hidden list on install', () => {
    // Without this the feature only works after a manual settings change: the
    // panel is usually mounted long after the module applied.
    const { panel, cells } = fakeNav(['Models', 'Agents', 'Settings page'])
    const document = fakeDocument()
    document.querySelector = (selector) => (selector === PANEL_SELECTOR ? panel : null)
    const React = fakeReact()
    const storage = fakeStorage()
    storage.map.set('dsh.better-setting-page.settings', JSON.stringify({
      version: 1, fullscreen: false, navCollapsed: false, hidden: ['agents'],
    }))
    const window = { localStorage: storage, addEventListener() {}, removeEventListener() {} }
    let mod = null
    window.__ModuleLoader__ = { load(entry) { mod = entry.factory(() => React) } }
    new Function('window', 'document', 'require', source)(window, document, () => React)
    const { ctx } = fakeSlotsCtx({
      entries: [
        { options: { id: 'models', order: 10, label: 'Models' } },
        { options: { id: 'agents', order: 20, label: 'Agents' } },
        { options: { id: mod.SECTION_ID, order: 50, label: 'Settings page' } },
      ],
    })
    const dispose = mod.installNavSync(ctx)
    equal(cells[0].getAttribute(mod.NAV_ID_ATTR), 'models', 'row tagged on install')
    equal(cells[1].getAttribute(mod.HIDDEN_ATTR), '1', 'stored hidden list applied on install')
    equal(cells[0].getAttribute(mod.HIDDEN_ATTR), null, 'unhidden row left alone')
    dispose()
  })
  check('a row whose label changed is still matched by position, not skipped', () => {
    const { panel, cells } = fakeNav(['型号（译名变了）', 'Agents'])
    const document = fakeDocument()
    document.querySelector = (selector) => (selector === PANEL_SELECTOR ? panel : null)
    const React = fakeReact()
    const window = { localStorage: fakeStorage(), addEventListener() {}, removeEventListener() {} }
    let mod = null
    window.__ModuleLoader__ = { load(entry) { mod = entry.factory(() => React) } }
    new Function('window', 'document', 'require', source)(window, document, () => React)
    mod.markNavRows([
      { id: 'models', order: 10, label: 'Models' },
      { id: 'agents', order: 20, label: 'Agents' },
    ])
    equal(cells[0].getAttribute(mod.NAV_ID_ATTR), 'models', 'position fallback')
    equal(cells[1].getAttribute(mod.NAV_ID_ATTR), 'agents', 'label match still wins when it agrees')
  })
}
//#endregion

//#region 12. display metadata (locale + icon)
/**
 * The host reads plugin display name/icon without evaluating any JavaScript:
 * `pluginPackages.metaOf()` reads `locale/<lang>.json` for `meta.title` and
 * `meta.description`, and `package.json` `icon` (or the exported `./icon`) for
 * the artwork. Both must be reachable through `exports`, or the packaged copy
 * will not have them and the plugin list falls back to the package name.
 */
{
  const pkg = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8'))

  check('package.json declares the display metadata the host reads', () => {
    equal(pkg.icon, './icon.svg', 'manifest icon')
    truthy(pkg.exports, 'exports present')
    equal(pkg.exports['./icon'], './icon.svg', 'exported icon')
    truthy(pkg.exports['./locale/*.json'], 'exported locale glob')
  })

  check('the icon ships inside the npm package', () => {
    truthy(pkg.files.includes('icon.svg'), 'files includes icon.svg')
    truthy(pkg.files.includes('locale'), 'files includes locale/')
    const svg = readFileSync(join(here, '..', 'icon.svg'), 'utf8')
    truthy(svg.startsWith('<svg'), 'icon.svg is an SVG')
    truthy(Buffer.byteLength(svg) <= 256 * 1024, 'icon stays under the hosts 256 KiB cap')
  })

  check('locale files carry a title and a description in both languages', () => {
    for (const lang of ['en', 'zh']) {
      const meta = JSON.parse(readFileSync(join(here, '..', 'locale', lang + '.json'), 'utf8')).meta
      truthy(meta && typeof meta.title === 'string' && meta.title.trim(), lang + ' title')
      truthy(meta && typeof meta.description === 'string' && meta.description.trim(), lang + ' description')
    }
  })
}
//#endregion

console.log('')
if (failures.length > 0) {
  console.log(`FAIL — ${failures.length} of ${groups} checks failed`)
  for (const failure of failures) console.log(`  ${failure.name}: ${failure.error && failure.error.message}`)
  process.exit(1)
}
console.log(`PASS — ${groups} groups`)
