import { AppErrors, type Result, err, ok } from '../../../core/result'
import type { MirrorControlMessage } from '../../../domain/device-mirror/entities/MirrorControlMessage'
import type { MirrorRequest } from '../../../domain/device-mirror/entities/MirrorRequest'
import type { MirrorStreamEvent } from '../../../domain/device-mirror/entities/MirrorStreamEvent'
import type { MirrorRepository } from '../../../domain/device-mirror/repositories/MirrorRepository'
import type { MirrorDeviceSession } from '../../../domain/device-mirror/repositories/MirrorDeviceGateway'
import type { WebUsbDeviceHub } from '../../adb/webusb/WebUsbDeviceHub'
import { SCRCPY_SERVER_PUBLIC_PATH, SCRCPY_SERVER_VERSION } from '../scrcpyServer'
import { startTangoSession } from '../tangoStart'

/**
 * Hiện thực cổng mirror chạy TRỌN TRONG TRÌNH DUYỆT — cùng vai trò với
 * `WebUsbAdbRepository` bên logcat: máy chủ không có vai trò gì, nên đây là
 * đường duy nhất chạy trên Vercel.
 *
 * So với `HttpMirrorRepository`, không có đường truyền nào ở giữa: scrcpy-server
 * được đẩy lên máy qua chính `Adb` mà `WebUsbDeviceHub` đang giữ, gói video
 * đi thẳng từ Tango tới `onEvent` (không qua `mirrorFrameCodec`), và
 * `sendControl` gọi thẳng vào phiên (không cần gộp lô — `createTangoSession`
 * đã nối chuỗi theo phiên). Phần bắt tay scrcpy (`startTangoSession`) dùng
 * chung với máy chủ, nên hai đường mở phiên với cùng tuỳ chọn và cùng câu lỗi.
 *
 * Jar: tệp tĩnh `public/scrcpy-server` (Apache-2.0, chép từ brew), tải bằng
 * `fetch` cùng gốc. Bản phải khớp `SCRCPY_SERVER_VERSION` — `scrcpyServer.ts`.
 *
 * `sessionId` ở đây chỉ để ViewModel/`sendControl` tra đúng phiên trong cùng
 * tab (`#sessions`); không có bảng phiên nào ở máy chủ, và cũng không có 409
 * giữa hai tab: hai tab không chia được một kết nối USB, tab thứ hai đã hỏng
 * từ lúc `adbReady` với lỗi `DeviceBusyError` của hub.
 */

const STREAM_CLOSED_UNEXPECTEDLY = 'Kết nối tới scrcpy-server đã đóng bất ngờ.'

export class WebUsbMirrorRepository implements MirrorRepository {
  readonly #hub: WebUsbDeviceHub
  readonly #fetchImpl: typeof fetch
  readonly #newId: () => string
  readonly #start: typeof startTangoSession
  /** Phiên đang chảy trong tab này, theo `sessionId` — để `sendControl` tra. */
  readonly #sessions = new Map<string, MirrorDeviceSession>()

  /**
   * `fetchImpl` là hàm BỌC, không phải `globalThis.fetch` trần — cùng lý do
   * với `HttpMirrorRepository`: gán `fetch` vào thuộc tính rồi gọi qua `this`
   * là `Illegal invocation` trên trình duyệt thật. `start` tiêm được để test
   * chạy không cần Tango lẫn máy thật.
   */
  constructor(
    hub: WebUsbDeviceHub,
    fetchImpl: typeof fetch = (input, init) => globalThis.fetch(input, init),
    newId: () => string = () => crypto.randomUUID(),
    start: typeof startTangoSession = startTangoSession,
  ) {
    this.#hub = hub
    this.#fetchImpl = fetchImpl
    this.#newId = newId
    this.#start = start
  }

  async stream(
    request: MirrorRequest,
    onEvent: (event: MirrorStreamEvent) => void,
    signal: AbortSignal,
  ): Promise<Result<void>> {
    const adb = await this.#hub.adbReady(request.serial, signal)
    if (!adb.ok) return adb

    const jar = await this.#fetchJar(signal)
    if (!jar.ok) return jar

    // `ownsAdb: false` — transport là của hub, logcat có thể đang chảy trên đó.
    const started = await this.#start(
      { adb: adb.value, ownsAdb: false, jar: jar.value, jarSource: SCRCPY_SERVER_PUBLIC_PATH, version: SCRCPY_SERVER_VERSION, request },
      signal,
    )
    if (!started.ok) return started

    const session = started.value
    const id = this.#newId()
    this.#sessions.set(id, session)

    // Huỷ = đóng phiên: `scrcpy.close()` giết app_process trên máy, socket
    // video đóng theo và vòng `for await` bên dưới kết thúc — không cần đường
    // dừng thứ hai. Đăng ký TRƯỚC khi phát `meta`, để một lượt huỷ tới ngay
    // sau `meta` không bị lọt.
    const onAbort = (): void => void session.close()
    signal.addEventListener('abort', onAbort, { once: true })
    // Huỷ lọt vào giữa lúc `start` trả về và dòng trên: listener không bắn.
    if (signal.aborted) onAbort()

    const unsubscribeSize = session.onSize(({ width, height }) => {
      if (!signal.aborted) onEvent({ type: 'size', width, height })
    })

    onEvent({
      type: 'meta',
      sessionId: id,
      deviceName: session.meta.deviceName,
      width: session.meta.width,
      height: session.meta.height,
      codec: 'h264',
      control: request.control,
    })

    let failure: Result<void> | null = null
    try {
      for await (const packet of session.packets()) {
        if (signal.aborted) break
        onEvent({ type: 'video', packet })
      }
    } catch (thrown) {
      failure = err(AppErrors.upstream(STREAM_CLOSED_UNEXPECTEDLY, { cause: thrown }))
    } finally {
      signal.removeEventListener('abort', onAbort)
      unsubscribeSize()
      this.#sessions.delete(id)
      await session.close()
    }

    if (signal.aborted) return err(AppErrors.cancelled('Đã dừng mirror.'))
    // Iterator kết thúc mà chưa ai huỷ: scrcpy-server trên máy chết hoặc rút cáp.
    return failure ?? err(AppErrors.upstream(STREAM_CLOSED_UNEXPECTEDLY))
  }

  async sendControl(sessionId: string, message: MirrorControlMessage, signal: AbortSignal): Promise<Result<void>> {
    if (signal.aborted) return err(AppErrors.cancelled('Đã huỷ.'))
    const session = this.#sessions.get(sessionId)
    if (session === undefined) {
      return err(AppErrors.notFound('Phiên mirror này đã đóng. Chạy lại để mở phiên mới.'))
    }
    return session.control([message])
  }

  async #fetchJar(signal: AbortSignal): Promise<Result<ReadableStream<Uint8Array>>> {
    let response: Response
    try {
      // Next phục vụ `public/` với `max-age=0` + ETag: lần mở sau vẫn hỏi
      // máy chủ nhưng thường chỉ nhận 304, không tải lại 90 KB.
      response = await this.#fetchImpl(SCRCPY_SERVER_PUBLIC_PATH, { signal })
    } catch (thrown) {
      if (signal.aborted) return err(AppErrors.cancelled('Đã dừng mirror.'))
      return err(AppErrors.network('Không tải được scrcpy-server từ máy chủ.', { cause: thrown }))
    }
    if (!response.ok || response.body === null) {
      // Thiếu tệp trong `public/` là lỗi của bản deploy, không phải của người dùng.
      return err(
        AppErrors.notFound(
          `Bản deploy này thiếu tệp scrcpy-server (${SCRCPY_SERVER_PUBLIC_PATH}). Chép jar ${SCRCPY_SERVER_VERSION} vào public/ rồi deploy lại.`,
        ),
      )
    }
    return ok(response.body)
  }
}
