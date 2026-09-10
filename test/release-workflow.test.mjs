import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { test } from 'node:test'
import { repositoryRoot } from '../scripts/release-support.mjs'
import { selectRelease } from '../scripts/select-release.mjs'

test('package tags select one version-matched release archive', async () => {
  assert.deepEqual(await selectRelease('theme-v2.7.1'), {
    archive: 'dist/logseq-dark-high-contrast-theme-2.7.1.zip',
    release_name: 'Dark High Contrast 2.7.1',
    workspace: 'packages/dark-high-contrast'
  })
  assert.deepEqual(await selectRelease('passage-v0.8.0'), {
    archive: 'dist/logseq-passage-0.8.0.zip',
    release_name: 'Passage 0.8.0',
    workspace: 'packages/passage'
  })
  assert.deepEqual(await selectRelease('anno-v0.1.0'), {
    archive: 'dist/logseq-anno-0.1.0.zip',
    release_name: 'Anno 0.1.0',
    workspace: 'packages/anno'
  })
})

test('release selection rejects legacy, unknown, and mismatched tags', async () => {
  await assert.rejects(selectRelease('v2.0.0'), /unsupported release tag/)
  await assert.rejects(selectRelease('unknown-v2.0.0'), /unsupported release tag/)
  await assert.rejects(selectRelease('theme-v2.0.1'), /does not match .*package.json version/)
  await assert.rejects(selectRelease('passage-v1.0.0'), /does not match .*package.json version/)
  await assert.rejects(selectRelease('anno-v9.9.9'), /does not match .*package.json version/)
})

test('workflows validate all changes and publish only the selected archive', async () => {
  const testWorkflow = await readFile(resolve(repositoryRoot, '.github/workflows/test.yml'), 'utf8')
  const publishWorkflow = await readFile(resolve(repositoryRoot, '.github/workflows/publish.yml'), 'utf8')

  assert.match(testWorkflow, /push:\s*\n\s*pull_request:/)
  assert.match(testWorkflow, /npm run check/)
  assert.match(testWorkflow, /git diff --check/)
  assert.match(publishWorkflow, /- "theme-v\*"/)
  assert.match(publishWorkflow, /- "passage-v\*"/)
  assert.match(publishWorkflow, /- "anno-v\*"/)
  assert.doesNotMatch(publishWorkflow, /- "v\*"/)
  assert.match(publishWorkflow, /scripts\/select-release\.mjs/)
  assert.match(publishWorkflow, /npm run check --workspace "\$\{\{ steps\.package\.outputs\.workspace \}\}"/)
  assert.match(publishWorkflow, /files: \$\{\{ steps\.package\.outputs\.archive \}\}/)
  assert.doesNotMatch(publishWorkflow, /dist\/\*\.zip/)
})
