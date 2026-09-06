import assert from 'node:assert/strict'
import { inflateRawSync } from 'node:zlib'

const EOCD_SIGNATURE = 0x06054b50
const CENTRAL_SIGNATURE = 0x02014b50

export function readArchive(buffer) {
  let eocd = buffer.length - 22
  while (eocd >= 0 && buffer.readUInt32LE(eocd) !== EOCD_SIGNATURE) eocd -= 1
  assert.ok(eocd >= 0, 'not a zip archive: no end-of-central-directory record')
  const total = buffer.readUInt16LE(eocd + 10)
  let cursor = buffer.readUInt32LE(eocd + 16)
  const entries = new Map()
  for (let index = 0; index < total; index += 1) {
    assert.equal(buffer.readUInt32LE(cursor), CENTRAL_SIGNATURE, 'malformed central directory')
    const method = buffer.readUInt16LE(cursor + 10)
    const compressedSize = buffer.readUInt32LE(cursor + 20)
    const nameLength = buffer.readUInt16LE(cursor + 28)
    const extraLength = buffer.readUInt16LE(cursor + 30)
    const commentLength = buffer.readUInt16LE(cursor + 32)
    const localOffset = buffer.readUInt32LE(cursor + 42)
    const name = buffer.toString('utf8', cursor + 46, cursor + 46 + nameLength).replace(/\\/g, '/')
    const dataStart = localOffset + 30 + buffer.readUInt16LE(localOffset + 26) + buffer.readUInt16LE(localOffset + 28)
    const raw = buffer.subarray(dataStart, dataStart + compressedSize)
    assert.ok(method === 0 || method === 8, `${name} uses unsupported compression method ${method}`)
    entries.set(name, method === 0 ? Buffer.from(raw) : inflateRawSync(raw))
    cursor += 46 + nameLength + extraLength + commentLength
  }
  return entries
}
