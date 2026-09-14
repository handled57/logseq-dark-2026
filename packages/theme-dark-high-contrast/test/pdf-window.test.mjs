/* Behavioral tests for the theme's pop-out PDF window support.
 *
 * Logseq's "open in a system window" PDF viewer is a `window.open` child of
 * the host document, and Logseq copies exactly one stylesheet into it — its
 * own `./css/style.css`. Everything else the host wears is left behind, which
 * is why the viewer and every popup it opens came up in Logseq's default
 * palette. The selected theme is one of those, and Logseq hangs it on a
 * `<link>` with nothing to find it by, so the entry copies whichever of the
 * host's stylesheets the child has not got. What is driven here is that
 * wrapper: which windows it dresses, what it copies, what it leaves alone, and
 * that unloading puts the host's `open` back.
 */

import assert from 'node:assert/strict'
import vm from 'node:vm'
import { dirname, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { classicScript } from '../../../test/support/classic-script.mjs'
import { descendants, matchesSelector, node } from '../../../test/support/host-document.mjs'

const root = dirname(fileURLToPath(import.meta.url))
const source = await classicScript(resolve(root, '..', 'index.js'))

/* Logseq's own stylesheet resolves to the same URL in both documents: the
 * child's `<base>` is the host's location. */
const LOGSEQ_CSS = 'file:///app/css/style.css'
const ICONS_CSS = 'file:///app/css/tabler-icons.min.css'
const THEME_HREF = 'file:///plugins/theme-dark-high-contrast/theme.css'
const MARK = 'data-hc-pdf-window'

function query(target, selector) {
  return descendants(target).find((child) => matchesSelector(child, selector)) ?? null
}

function stylesheet(href, options = {}) {
  return Object.assign(node('link', { attributes: { rel: 'stylesheet' }, ...options }), { href })
}

/* The child Logseq builds: a head holding the one stylesheet Logseq copies,
 * and a root element that carries `is-system-window` once it is set up. */
function pdfWindow({ system = true, sheets = [LOGSEQ_CSS] } = {}) {
  const head = node('head')
  for (const href of sheets) head.appendChild(stylesheet(href))

  const documentElement = node('html', { classes: system ? ['is-system-window'] : [] })
  const win = {
    closed: false,
    document: {
      head,
      documentElement,
      createElement: (tag) => node(tag),
      querySelector: (selector) => query(head, selector),
      querySelectorAll: (selector) => head.querySelectorAll(selector)
    }
  }

  return { win, head, documentElement }
}

function copied(head) {
  return head.querySelectorAll(`[${MARK}]`)
}

function load({ sheets = [ICONS_CSS, LOGSEQ_CSS, THEME_HREF], accent = '' } = {}) {
  const body = node('body')
  const head = node('head')
  for (const href of sheets) head.appendChild(stylesheet(href))

  const documentElement = node('html', { attributes: accent ? { 'data-color': accent } : {} })
  documentElement.appendChild(head)
  documentElement.appendChild(body)

  const timers = []
  const unloads = []
  const opened = []
  let hostOpen = null

  const context = {
    console,
    MutationObserver: class {
      observe() {}
      disconnect() {}
    },
    parent: {
      requestAnimationFrame() {},
      setTimeout(callback) {
        timers.push(callback)
      },
      open(...args) {
        opened.push(args)
        return hostOpen
      },
      document: {
        body,
        documentElement,
        createElement: (tag) => node(tag),
        addEventListener() {},
        removeEventListener() {},
        querySelector: (selector) => documentElement.querySelector(selector),
        querySelectorAll: (selector) => documentElement.querySelectorAll(selector)
      }
    },
    logseq: {
      settings: {},
      Editor: {
        async getBlock() {
          return null
        },
        registerBlockContextMenuItem() {}
      },
      App: { onRouteChanged() {}, pushState() {} },
      beforeunload(handler) {
        unloads.push(handler)
      },
      useSettingsSchema() {},
      updateSettings() {},
      provideStyle() {},
      onSettingsChanged() {},
      ready(main) {
        return Promise.resolve(main())
      }
    }
  }

  vm.createContext(context)
  source.runInContext(context)

  context.body = body
  context.opened = opened
  context.unloads = unloads
  context.timers = timers
  /* Logseq builds the child after `open` returns, so the entry looks again on
   * the microtask that follows and then on a timer; the test drives both. */
  context.settle = async (times = 3) => {
    for (let turn = 0; turn < times; turn += 1) {
      await Promise.resolve()
      const pending = timers.splice(0, timers.length)
      for (const timer of pending) timer()
    }
  }
  context.openWindow = (win) => {
    hostOpen = win
    return context.parent.open('about:blank', '_blank', 'width=700,height=800')
  }

  return context
}

async function started(options) {
  const context = load(options)
  await Promise.resolve()
  return context
}

test('hands the pop-out PDF window every stylesheet the host has and it lacks', async () => {
  const context = await started()
  const { win, head } = pdfWindow()

  context.openWindow(win)
  await context.settle()

  const links = copied(head)
  assert.deepEqual(links.map((link) => link.href), [ICONS_CSS, THEME_HREF])
  for (const link of links) {
    assert.equal(link.tagName, 'LINK')
    assert.equal(link.rel, 'stylesheet')
  }
})

test('copies the theme in after the stylesheet Logseq gave the child', async () => {
  const context = await started()
  const { win, head } = pdfWindow()

  context.openWindow(win)
  await context.settle()

  assert.deepEqual(
    head.children.map((link) => link.href),
    [LOGSEQ_CSS, ICONS_CSS, THEME_HREF],
    'the theme must come last, or Logseq’s own palette outranks it'
  )
})

test('does not copy a stylesheet the child already has', async () => {
  const context = await started()
  const { win, head } = pdfWindow()

  context.openWindow(win)
  await context.settle()

  assert.equal(head.querySelectorAll('link').filter((link) => link.href === LOGSEQ_CSS).length, 1)
})

test('forwards the open call and returns the host window untouched', async () => {
  const context = await started()
  const { win } = pdfWindow()

  assert.equal(context.openWindow(win), win)
  assert.deepEqual(context.opened, [['about:blank', '_blank', 'width=700,height=800']])
})

test('leaves the host accent behind, so nothing accent-scoped outranks the palette', async () => {
  const context = await started({ accent: 'blue' })
  const { win, documentElement } = pdfWindow()

  context.openWindow(win)
  await context.settle()

  assert.equal(documentElement.getAttribute('data-color'), null)
})

test('leaves an ordinary popup alone', async () => {
  const context = await started()
  const { win, head } = pdfWindow({ system: false })

  context.openWindow(win)
  await context.settle(5)

  assert.equal(copied(head).length, 0)
})

test('stops looking at a window that never becomes a PDF viewer', async () => {
  const context = await started()
  const { win } = pdfWindow({ system: false })

  context.openWindow(win)
  await context.settle(200)

  assert.equal(context.timers.length, 0, 'the entry should give up rather than watch forever')
})

test('dresses a window that only becomes the viewer on a later try', async () => {
  const context = await started()
  const { win, head, documentElement } = pdfWindow({ system: false })

  context.openWindow(win)
  await context.settle(1)
  assert.equal(copied(head).length, 0)

  documentElement.classList.add('is-system-window')
  await context.settle(1)
  assert.equal(copied(head).length, 2)
})

test('copies once, however many tries run', async () => {
  const context = await started()
  const { win, head } = pdfWindow()

  context.openWindow(win)
  await context.settle(5)

  assert.equal(copied(head).length, 2)
})

test('does nothing when the child already wears everything the host does', async () => {
  const context = await started({ sheets: [LOGSEQ_CSS] })
  const { win, head } = pdfWindow()

  context.openWindow(win)
  await context.settle(5)

  assert.equal(copied(head).length, 0)
})

test('skips a window that closed before it was dressed', async () => {
  const context = await started()
  const { win, head } = pdfWindow()
  win.closed = true

  context.openWindow(win)
  await context.settle(5)

  assert.equal(copied(head).length, 0)
})

test('unloading restores the host open and strips the stylesheets it added', async () => {
  const context = await started()
  const { win, head } = pdfWindow()
  const wrapped = context.parent.open

  context.openWindow(win)
  await context.settle()
  assert.equal(copied(head).length, 2)

  for (const unload of context.unloads) await unload()

  assert.notEqual(context.parent.open, wrapped)
  assert.equal(copied(head).length, 0)
  assert.deepEqual(head.children.map((link) => link.href), [LOGSEQ_CSS])

  const next = pdfWindow()
  context.openWindow(next.win)
  await context.settle()
  assert.equal(copied(next.head).length, 0, 'the unloaded theme should dress no further windows')
})
