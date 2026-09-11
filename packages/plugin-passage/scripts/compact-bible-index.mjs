#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { compactLegacyIndex, TranslationIndex } from './translation-index.mjs'

function option(name) {
  const position = process.argv.indexOf(`--${name}`)
  return position === -1 ? undefined : process.argv[position + 1]
}

const input = option('input')
const output = option('output')
if (!input || !output) throw new Error('usage: compact-bible-index.mjs --input <file> --output <file>')
const compact = compactLegacyIndex(JSON.parse(await readFile(resolve(input), 'utf8')))
new TranslationIndex(compact)
await writeFile(resolve(output), `${JSON.stringify(compact)}\n`)
console.log(`Wrote schema ${compact.schemaVersion}: ${compact.stats.books} books, ${compact.stats.verses} verses`)
