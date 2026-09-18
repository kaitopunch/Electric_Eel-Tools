import { statSync } from 'node:fs'

import { AppErrors, type Result, err, ok } from '../../core/result'
import { isAdbEnabled } from '../adb/adbSettings'
import { SCRCPY_JAR_NOT_FOUND_MESSAGE, SCRCPY_SERVER_VERSION } from './scrcpyServer'

/**
 * Cấu hình của ô Phản chiếu (mirror) trong Logcat.
 *
 * Dùng chung cờ `ADB_ENABLED` với công cụ Logcat — cùng lý do: cả hai chỉ hữu
 * ích khi adb ở máy chủ nhìn thấy thiết bị thật, và cùng mặc định an toàn (bật
 * khi dev, tắt ở production trừ khi tự tay bật).
 */
export interface MirrorSettings {
  /** Đường dẫn tới file `scrcpy-server` (jar) trên máy chủ. */
  readonly jarPath: string
  /** Bản scrcpy-server phải khớp — lệch bản thì server tự thoát ngay khi start. */
  readonly version: string
}

/**
 * `brew install scrcpy` đặt jar ở đây tuỳ hệ điều hành/kiến trúc. Dò theo thứ
 * tự này khi `SCRCPY_SERVER_PATH` bỏ trống, thay vì bắt người dùng tự tìm.
 */
const DEFAULT_JAR_CANDIDATES = [
  '/opt/homebrew/share/scrcpy/scrcpy-server',
  '/usr/local/share/scrcpy/scrcpy-server',
  '/usr/share/scrcpy/scrcpy-server',
] as const

/** Bản mặc định — một hằng dùng chung với đường WebUSB, xem `scrcpyServer.ts`. */
const DEFAULT_VERSION = SCRCPY_SERVER_VERSION
const VERSION_PATTERN = /^\d+\.\d+(\.\d+)?$/

/** Hai câu báo về jar sống ở `scrcpyServer.ts` (không `node:fs`); re-export để chỗ gọi cũ không đổi. */
export { JAR_UNREADABLE_MESSAGE, SCRCPY_JAR_NOT_FOUND_MESSAGE } from './scrcpyServer'

/**
 * "Tồn tại" ở đây nghĩa là một TỆP THƯỞNG. `existsSync` trả `true` với cả thư
 * mục (`SCRCPY_SERVER_PATH=/`), và lỗi khi đó chỉ lộ ra ở `pushServer` dưới
 * dạng `EISDIR` khó hiểu — chặn ngay từ lúc đọc cấu hình.
 */
const isRegularFile = (path: string): boolean => statSync(path, { throwIfNoEntry: false })?.isFile() ?? false

export function readMirrorSettings(
  env: NodeJS.ProcessEnv = process.env,
  exists: (path: string) => boolean = isRegularFile,
): Result<MirrorSettings> {
  if (!isAdbEnabled(env)) {
    return err(
      AppErrors.forbidden(
        'Phản chiếu màn hình đang tắt trên máy chủ này. Đặt ADB_ENABLED=true nếu adb ở đây thật sự nhìn thấy thiết bị của bạn.',
      ),
    )
  }

  const configured = env.SCRCPY_SERVER_PATH?.trim()
  const jarPath =
    configured !== undefined && configured.length > 0
      ? configured
      : DEFAULT_JAR_CANDIDATES.find((candidate) => exists(candidate))

  if (jarPath === undefined || !exists(jarPath)) {
    return err(AppErrors.notFound(SCRCPY_JAR_NOT_FOUND_MESSAGE))
  }

  const version = env.SCRCPY_SERVER_VERSION?.trim() || DEFAULT_VERSION
  if (!VERSION_PATTERN.test(version)) {
    return err(
      AppErrors.validation(
        `SCRCPY_SERVER_VERSION "${version}" không đúng định dạng. Dùng dạng x.y hoặc x.y.z, ví dụ ${DEFAULT_VERSION}.`,
      ),
    )
  }

  return ok({ jarPath, version })
}
