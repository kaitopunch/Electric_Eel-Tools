// Không `import 'server-only'` — CỐ Ý, cùng lý do với `tangoSession.ts`: đây
// là phần dựng phiên DÙNG CHUNG cho hai đường mirror. Chỉ khác nhau ở chỗ
// `Adb` và jar từ đâu tới, nên hai thứ đó là tham số.
import type { Adb } from '@yume-chan/adb'
import { AdbScrcpyClient, AdbScrcpyOptions3_3_3 } from '@yume-chan/adb-scrcpy'
import { DefaultServerPath, ScrcpyInstanceId } from '@yume-chan/scrcpy'

import { AppErrors, type Result, err, ok } from '../../core/result'
import { MIRROR_QUALITY } from '../../domain/device-mirror/entities/MirrorRequest'
import type { MirrorRequest } from '../../domain/device-mirror/entities/MirrorRequest'
import type { MirrorDeviceSession } from '../../domain/device-mirror/repositories/MirrorDeviceGateway'
import { describeMirrorFailure } from './mirrorFailure'
import { type ScrcpyClient, type StreamReader, closeTangoResources, createTangoSession } from './tangoSession'

const OUTPUT_LINE_CAP = 200
/** Trần cho MỖI bước bắt tay Tango — máy treo hay Samsung từ chối `app_process` mà không thoát thì không đợi vô hạn. */
const STEP_TIMEOUT_MS = 15_000

type JarStream = Parameters<typeof AdbScrcpyClient.pushServer>[1]

export interface TangoStartInput {
  /** Transport tới máy, đã bắt tay xong. */
  readonly adb: Adb
  /**
   * Phiên có SỞ HỮU `adb` không. Máy chủ mở một `Adb` riêng cho mỗi phiên →
   * `true`, đóng cùng phiên. Trình duyệt mượn `Adb` của `WebUsbDeviceHub` →
   * `false`, để nguyên cho hub.
   */
  readonly ownsAdb: boolean
  /** Nội dung jar `scrcpy-server`, đẩy lên máy trước khi start. */
  readonly jar: ReadableStream<Uint8Array>
  /** Nơi jar tới từ — chỉ để `describeMirrorFailure` ghi vào `detail`. */
  readonly jarSource: string
  readonly version: string
  readonly request: MirrorRequest
}

/** Đọc stderr của scrcpy-server song song, không chờ — xem ghi chú trong `startTangoSession()`. */
async function drainOutput(reader: StreamReader<string>, into: string[]): Promise<void> {
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done === true || value === undefined) return
      if (into.length < OUTPUT_LINE_CAP) into.push(value)
    }
  } catch {
    // Luồng đóng cùng lúc tiến trình thoát — không phải lỗi cần xử lý riêng,
    // `describeMirrorFailure` chỉ cần mảng đã gom được tới thời điểm này.
  } finally {
    reader.releaseLock()
  }
}

/**
 * Tango không biết gì về `AbortSignal`. Mỗi bước `await` dài được bọc ở đây
 * để (1) đóng tab lúc "Đang nối…" là thoát ngay, và (2) không có bước nào
 * treo quá `STEP_TIMEOUT_MS`. Cả hai đều ném `AppError` để
 * `describeMirrorFailure` trả nguyên về, không quy nhầm thành `unknown`.
 */
export function raceAbort<T>(promise: Promise<T>, signal: AbortSignal, step: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal.aborted) {
      reject(AppErrors.cancelled('Đã huỷ.'))
      return
    }
    const timer = setTimeout(
      () => reject(AppErrors.network(`${step} không trả lời sau ${String(STEP_TIMEOUT_MS / 1000)}s.`)),
      STEP_TIMEOUT_MS,
    )
    const onAbort = () => reject(AppErrors.cancelled('Đã huỷ.'))
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(resolve, reject).finally(() => {
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
    })
  })
}

/**
 * Đẩy jar → start scrcpy-server → chờ luồng video, trên một `Adb` có sẵn.
 *
 * Mọi nhánh thoát sớm (lỗi, huỷ, hết giờ) đều đi qua `closeTangoResources` —
 * kể cả khi `scrcpy` chưa kịp có. `adb` chỉ bị đóng khi `ownsAdb`.
 */
export async function startTangoSession(
  input: TangoStartInput,
  signal: AbortSignal,
): Promise<Result<MirrorDeviceSession>> {
  const { adb, request, version } = input
  const ownedAdb = input.ownsAdb ? adb : undefined
  const outputLines: string[] = []
  let scrcpy: ScrcpyClient | undefined

  // Huỷ trước khi bắt đầu thì đừng mở socket sync và ghi 90 KB lên máy vô ích.
  if (signal.aborted) return err(AppErrors.cancelled('Đã huỷ.'))

  try {
    await raceAbort(
      AdbScrcpyClient.pushServer(adb, input.jar as unknown as JarStream),
      signal,
      'Đẩy scrcpy-server lên máy',
    )

    const options = new AdbScrcpyOptions3_3_3(
      {
        video: true,
        audio: false,
        control: request.control,
        tunnelForward: true,
        videoCodec: 'h264',
        // Chất lượng cố định ở mức cao nhất — xem `MIRROR_QUALITY`.
        maxSize: MIRROR_QUALITY.maxSize,
        maxFps: MIRROR_QUALITY.maxFps,
        videoBitRate: MIRROR_QUALITY.bitRateMbps * 1_000_000,
        clipboardAutosync: false,
        scid: ScrcpyInstanceId.random(),
        // 'debug' để bắt dòng "Using video encoder". KHÔNG 'verbose' — làm
        // scrcpy-server 3.3.4 CRASH dù kiểu `LogLevel` vẫn liệt kê nó hợp lệ
        // (spike-report §2 mục 7).
        logLevel: 'debug',
      },
      { version },
    )

    // `raceAbort` chỉ bỏ CHỜ, không bỏ được lời gọi: `start()` gốc vẫn chạy
    // tiếp và trả về một client không ai giữ. Ở đường máy chủ, `Adb.close()`
    // từng dọn hộ; ở WebUSB `Adb` là của hub nên không có lưới đỡ đó — phải
    // đón client tới muộn và đóng nó, nếu không app_process mồ côi giữ encoder
    // và hai socket trên đúng `Adb` mà logcat đang dùng.
    const starting = AdbScrcpyClient.start(adb, DefaultServerPath, options)
    try {
      scrcpy = await raceAbort(starting, signal, 'scrcpy-server')
    } catch (thrown) {
      void starting.then(
        (late) => late.close().catch(() => undefined),
        () => undefined,
      )
      throw thrown
    }

    // Đọc stderr NGAY, không `await` — không đọc thì `output` nghẽn ngược, và
    // mảng này là nguồn `detail` DUY NHẤT nếu `videoStream` không bao giờ
    // resolve (spike-report §2 mục 6).
    void drainOutput(scrcpy.output.getReader(), outputLines)

    const videoStream = await raceAbort(scrcpy.videoStream, signal, 'Luồng video của scrcpy-server')

    return ok(createTangoSession(scrcpy, ownedAdb, videoStream))
  } catch (thrown) {
    await closeTangoResources(scrcpy, ownedAdb)
    return err(describeMirrorFailure(thrown, outputLines, input.jarSource, version))
  }
}
