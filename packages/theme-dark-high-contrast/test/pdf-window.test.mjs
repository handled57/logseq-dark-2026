/* Behavioral tests for the theme's pop-out PDF window support.
 *
 * Logseq's "open in a system window" PDF viewer is a `window.open` child of
 * the host document, and Logseq copies exactly one stylesheet into it — its
 * own `./css/style.css`. The custom theme the host wears is left behind, which
 * is why the viewer and every popup it opens came up in Logseq's default
 * palette. The entry wraps the host's `open` to hand the child the same
 * stylesheet, so what is driven here is that wrapper: which windows it dresses,
 * what it leaves alone, and that unloading puts the host's `open` back.
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

const THEME_HREF = 'file:///plugins/theme-dark-high-contrast/theme.css'

function query(target, selector) {
  return descendants(target).find((child) => matchesSelector(child, selector)) ?? null
}

/* The child Logseq builds: a document with a head, and a root element that
 * carries `is-system-window` once Logseq has set it up. */
function pdfWindow({ system = true } = {}) {
  const head = node('head')
  const documentElement = node('html', { classes: system ? ['is-system-window'] : [] })
  const win = {
    closed: false,
    document: {
      head,
      documentElement,
      createElement: (tag) => node(tag),
      querySelector: (selector) => query(head, selector)
    }
  }

  return { win, head, documentElement }
}

function load({ theme = THEME_HREF, accent = '' } = {}) {
  const body = node('body')
  const head = node('head')
  if (theme) head.appendChild(Object.assign(node('link', { id: 'logseq-custom-theme-id' }), { href: theme }))

  const documentElement = node('html', { attributes: accent ? { 'data-color': accent } : {} })
  const frames = []
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
      requestAnimationFrame(callback) {
        frames.push(callback)
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
        querySelector: (selector) => query(head, selector) ?? body.querySelector(selector),
        querySelectorAll: (selector) => body.querySelectorAll(selector)
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
  /* Logseq builds the child after `open` returns, so the entry looks again on
   * later frames; the test drives those by hand. */
  context.settle = (times = 3) => {
    for (let turn = 0; turn < times; turn += 1) {
      const pending = frames.splice(0, frames.length)
      for (const frame of pending) frame()
    }
  }
  context.frames = frames
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

function injected(head) {
  return query(head, '#hc-pdf-window-theme')
}

test('hands the pop-out PDF window the theme the host is wearing', async () => {
  const context = await started()
  const { win, head } = pdfWindow()

  context.openWindow(win)
  context.settle()

  const link = injected(head)
  assert.ok(link, 'the child window should carry the theme stylesheet')
  assert.equal(link.tagName, 'LINK')
  assert.equal(link.rel, 'stylesheet')
  assert.equal(link.href, THEME_HREF)
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
  context.settle()

  assert.equal(documentElement.getAttribute('data-color'), null)
})

test('leaves an ordinary popup alone', async () => {
  const context = await started()
  const { win, head } = pdfWindow({ system: false })

  context.openWindow(win)
  context.settle(5)

  assert.equal(injected(head), null)
})

test('stops looking at a window that never becomes a PDF viewer', async () => {
  const context = await started()
  const { win } = pdfWindow({ system: false })

  context.openWindow(win)
  context.settle(200)

  assert.equal(context.frames.length, 0, 'the entry should give up rather than watch forever')
})

test('dresses a window that only becomes the viewer on a later frame', async () => {
  const context = await started()
  const { win, head, documentElement } = pdfWindow({ system: false })

  context.openWindow(win)
  context.settle(1)
  assert.equal(injected(head), null)

  documentElement.classList.add('is-system-window')
  context.settle(1)
  assert.ok(injected(head))
})

test('adds the stylesheet once, however many frames run', async () => {
  const context = await started()
  const { win, head } = pdfWindow()

  context.openWindow(win)
  context.settle(5)

  assert.equal(descendants(head).filter((child) => child.id === 'hc-pdf-window-theme').length, 1)
})

test('does nothing when no custom theme link is on the host', async () => {
  const context = await started({ theme: '' })
  const { win, head } = pdfWindow()

  context.openWindow(win)
  context.settle(5)

  assert.equal(injected(head), null)
})

test('skips a window that closed before it was dressed', async () => {
  const context = await started()
  const { win, head } = pdfWindow()
  win.closed = true

  context.openWindow(win)
  context.settle(5)

  assert.equal(injected(head), null)
})

test('unloading restores the host open and strips the stylesheet it added', async () => {
  const context = await started()
  const { win, head } = pdfWindow()
  const wrapped = context.parent.open

  context.openWindow(win)
  context.settle()
  assert.ok(injected(head))

  for (const unload of context.unloads) await unload()

  assert.notEqual(context.parent.open, wrapped)
  assert.equal(injected(head), null)

  const next = pdfWindow()
  context.openWindow(next.win)
  context.settle()
  assert.equal(injected(next.head), null, 'the unloaded theme should dress no further windows')
})
