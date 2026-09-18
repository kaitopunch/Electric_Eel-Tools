import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { AppErrors, type Result, err, ok } from '../../../core/result'
import type { MirrorControlMessage } from '../../../domain/device-mirror/entities/MirrorControlMessage'
import type { MirrorStreamEvent } from '../../../domain/device-mirror/entities/MirrorStreamEvent'
import type { MirrorVideoPacket } from '../../../domain/device-mirror/entities/MirrorVideoPacket'
import type { MirrorDeviceSession } from '../../../domain/device-mirror/repositories/MirrorDeviceGateway'
import type { WebUsbDeviceHub } from '../../adb/webusb/WebUsbDeviceHub'
import type { TangoStartInput } from '../tangoStart'
import { WebUsbMirrorRepository } from './WebUsbMirrorRepository'

/**
 * Phiên giả: gói video đẩy vào bằng tay qua `push`, kết thúc bằng `end`.
 * `close()` cũng kết thúc luồng — đúng như `scrcpy.close()` giết app_process
 * làm socket video đóng theo.
 */
function fakeSession() {
  const queue: MirrorVideoPacket[] = []
  let ended = false
  let wake: (() => void) | null = null
  const notify = () => {
    wake?.()
    wake = null
  }
  const sizeListeners = new Set<(size: { width: number; height: number }) => void>()
  const controls: MirrorControlMessage[][] = []
  let closes = 0

  const session: MirrorDeviceSession = {
    meta: { deviceName: 'Pixel', width: 0, height: 0 },
    async *packets() {
      for (;;) {
        const next = queue.shift()
        if (next !== undefined) {
          yield next
          continue
        }
        if (ended) return
        await new Promise<void>((resolve) => {
          wake = resolve
        })
      }
    },
    onSize: (listener) => {
      sizeListeners.add(listener)
      return () => sizeListeners.delete(listener)
    },
    control: async (messages) => {
      controls.push([...messages])
      return ok(undefined)
    },
    close: async () => {
      closes += 1
      ended = true
      notify()
    },
  }
  return {
    session,
    push: (packet: MirrorVideoPacket) => {
      queue.push(packet)
      notify()
    },
    end: () => {
      ended = true
      notify()
    },
    rotate: (width: number, height: number) => sizeListeners.forEach((l) => l({ width, height })),
    controls,
    closes: () => closes,
    sizeListeners: () => sizeListeners.size,
  }
}

const ADB = { fake: true } as unknown as Awaited<ReturnType<WebUsbDeviceHub['adbReady']>> extends Result<infer T> ? T : never

function makeRepo(options: {
  adb?: Result<typeof ADB>
  jarStatus?: number
  start?: (input: TangoStartInput, signal: AbortSignal) => Promise<Result<MirrorDeviceSession>>
} = {}) {
  const hub = {
    adbReady: async () => options.adb ?? ok(ADB),
  } as unknown as WebUsbDeviceHub
  const fetchCalls: string[] = []
  const fetchImpl: typeof fetch = async (input) => {
    fetchCalls.push(String(input))
    const status = options.jarStatus ?? 200
    return new Response(status === 200 ? new Uint8Array([1, 2, 3]) : null, { status })
  }
  const startCalls: TangoStartInput[] = []
  const start =
    options.start ??
    (async (input: TangoStartInput) => {
      startCalls.push(input)
      return ok(fakeSession().session)
    })
  const repo = new WebUsbMirrorRepository(hub, fetchImpl, () => 'sess-1', async (input, signal) => {
    startCalls.push(input)
    return start(input, signal)
  })
  return { repo, fetchCalls, startCalls }
}

const frame = (n: number): MirrorVideoPacket => ({ type: 'frame', keyframe: false, pts: BigInt(n), data: new Uint8Array([n]) })

describe('WebUsbMirrorRepository.stream', () => {
  it('trả lỗi của hub nguyên vẹn khi máy chưa sẵn sàng, không tải jar', async () => {
    const forbidden = AppErrors.forbidden('Thiết bị chưa cho phép gỡ lỗi.')
    const { repo, fetchCalls } = makeRepo({ adb: err(forbidden) })
    const outcome = await repo.stream({ serial: 'A', control: true }, () => undefined, new AbortController().signal)
    assert.equal(outcome.ok, false)
    if (!outcome.ok) assert.equal(outcome.error, forbidden)
    assert.deepEqual(fetchCalls, [])
  })

  it('jar thiếu trong public/ → notFound nói đúng việc deploy', async () => {
    const { repo, startCalls } = makeRepo({ jarStatus: 404 })
    const outcome = await repo.stream({ serial: 'A', control: true }, () => undefined, new AbortController().signal)
    assert.equal(outcome.ok, false)
    if (!outcome.ok) {
      assert.equal(outcome.error.kind, 'notFound')
      assert.match(outcome.error.message, /public\//)
    }
    assert.equal(startCalls.length, 0)
  })

  it('mượn Adb của hub (ownsAdb=false), khai đúng bản, rồi phát meta → video → size', async () => {
    const fake = fakeSession()
    const { repo, startCalls, fetchCalls } = makeRepo({ start: async () => ok(fake.session) })
    const events: MirrorStreamEvent[] = []
    const controller = new AbortController()

    const done = repo.stream({ serial: 'A', control: true }, (e) => events.push(e), controller.signal)
    await new Promise((r) => setTimeout(r, 0))

    assert.deepEqual(fetchCalls, ['/scrcpy-server'])
    assert.equal(startCalls[0]?.ownsAdb, false)
    assert.equal(startCalls[0]?.adb, ADB)
    assert.equal(startCalls[0]?.request.control, true)
    assert.match(startCalls[0]?.version ?? '', /^\d+\.\d+/)

    fake.push(frame(1))
    await new Promise((r) => setTimeout(r, 0))
    fake.rotate(1080, 2400)

    assert.deepEqual(
      events.map((e) => e.type),
      ['meta', 'video', 'size'],
    )
    assert.deepEqual(events[0], {
      type: 'meta',
      sessionId: 'sess-1',
      deviceName: 'Pixel',
      width: 0,
      height: 0,
      codec: 'h264',
      control: true,
    })

    controller.abort()
    const outcome = await done
    assert.equal(outcome.ok, false)
    if (!outcome.ok) assert.equal(outcome.error.kind, 'cancelled')
    assert.ok(fake.closes() >= 1, 'huỷ phải đóng phiên (giết scrcpy-server trên máy)')
    assert.equal(fake.sizeListeners(), 0, 'gỡ listener xoay màn hình khi xong')
  })

  it('luồng tự kết thúc khi chưa ai huỷ → upstream, phiên vẫn được đóng', async () => {
    const fake = fakeSession()
    const { repo } = makeRepo({ start: async () => ok(fake.session) })
    const done = repo.stream({ serial: 'A', control: false }, () => undefined, new AbortController().signal)
    await new Promise((r) => setTimeout(r, 0))
    fake.end()
    const outcome = await done
    assert.equal(outcome.ok, false)
    if (!outcome.ok) assert.equal(outcome.error.kind, 'upstream')
    assert.equal(fake.closes(), 1)
  })
})

describe('WebUsbMirrorRepository.sendControl', () => {
  it('phiên không có (đã đóng) → notFound', async () => {
    const { repo } = makeRepo()
    const outcome = await repo.sendControl('nope', { type: 'rotate' }, new AbortController().signal)
    assert.equal(outcome.ok, false)
    if (!outcome.ok) assert.equal(outcome.error.kind, 'notFound')
  })

  it('gọi thẳng vào phiên đang chảy; sau khi luồng dừng thì không còn tra được', async () => {
    const fake = fakeSession()
    const { repo } = makeRepo({ start: async () => ok(fake.session) })
    const controller = new AbortController()
    const done = repo.stream({ serial: 'A', control: true }, () => undefined, controller.signal)
    await new Promise((r) => setTimeout(r, 0))

    const sent = await repo.sendControl('sess-1', { type: 'rotate' }, new AbortController().signal)
    assert.equal(sent.ok, true)
    assert.deepEqual(fake.controls, [[{ type: 'rotate' }]])

    controller.abort()
    await done
    const after = await repo.sendControl('sess-1', { type: 'rotate' }, new AbortController().signal)
    assert.equal(after.ok, false)
  })
})
