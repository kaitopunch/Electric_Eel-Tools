import assert from 'node:assert/strict'
import { readFileSync, statSync } from 'node:fs'
import { describe, it } from 'node:test'
import { inflateRawSync } from 'node:zlib'

import { SCRCPY_SERVER_PUBLIC_PATH, SCRCPY_SERVER_VERSION } from './scrcpyServer'

/**
 * Bắt lỗi "brew upgrade scrcpy xong đổi hằng mà quên chép jar mới vào
 * public/" (hoặc ngược lại). Ở đường máy chủ, lệch bản lộ ngay ở lần mở đầu
 * tiên trên máy dev; ở đường WebUSB thì chỉ lộ SAU KHI deploy — nên kiểm ở
 * đây, trước khi build.
 *
 * Jar không có MANIFEST ghi bản; bản là chuỗi hằng `SCRCPY_VERSION` trong
 * `classes.dex` (đã nén deflate). Đọc một entry zip bằng central directory +
 * `inflateRawSync` — đủ cho một tệp năm entry, không đáng thêm dependency.
 */
function readZipEntry(zip: Buffer, wanted: string): Buffer {
  const EOCD = 0x06054b50
  const CENTRAL = 0x02014b50
  let eocd = zip.length - 22
  while (eocd >= 0 && zip.readUInt32LE(eocd) !== EOCD) eocd -= 1
  assert.ok(eocd >= 0, 'không tìm thấy end-of-central-directory')

  let offset = zip.readUInt32LE(eocd + 16)
  const entries = zip.readUInt16LE(eocd + 10)
  for (let i = 0; i < entries; i += 1) {
    assert.equal(zip.readUInt32LE(offset), CENTRAL)
    const method = zip.readUInt16LE(offset + 10)
    const compressedSize = zip.readUInt32LE(offset + 20)
    const nameLength = zip.readUInt16LE(offset + 28)
    const extraLength = zip.readUInt16LE(offset + 30)
    const commentLength = zip.readUInt16LE(offset + 32)
    const localOffset = zip.readUInt32LE(offset + 42)
    const name = zip.toString('utf8', offset + 46, offset + 46 + nameLength)
    offset += 46 + nameLength + extraLength + commentLength
    if (name !== wanted) continue

    const localNameLength = zip.readUInt16LE(localOffset + 26)
    const localExtraLength = zip.readUInt16LE(localOffset + 28)
    const dataStart = localOffset + 30 + localNameLength + localExtraLength
    const data = zip.subarray(dataStart, dataStart + compressedSize)
    return method === 0 ? data : inflateRawSync(data)
  }
  throw new Error(`không có entry ${wanted} trong jar`)
}

describe('public/scrcpy-server', () => {
  const jarPath = `public${SCRCPY_SERVER_PUBLIC_PATH}`

  it('có mặt và không rỗng', () => {
    assert.ok(statSync(jarPath).size > 10_000, `${jarPath} phải là jar thật, không phải tệp rỗng`)
  })

  it(`là bản ${SCRCPY_SERVER_VERSION} mà trình duyệt sẽ khai với server`, () => {
    const dex = readZipEntry(readFileSync(jarPath), 'classes.dex')
    assert.ok(
      dex.includes(Buffer.from(`The server version (${SCRCPY_SERVER_VERSION})`, 'utf8')),
      `Jar trong public/ không phải bản ${SCRCPY_SERVER_VERSION}. Chép lại từ $(brew --prefix)/share/scrcpy/scrcpy-server hoặc sửa SCRCPY_SERVER_VERSION.`,
    )
  })
})
