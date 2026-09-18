import { HttpAdbRepository } from '@/data/adb/HttpAdbRepository'
import { WebUsbAdbRepository } from '@/data/adb/webusb/WebUsbAdbRepository'
import { WebUsbDeviceHub } from '@/data/adb/webusb/WebUsbDeviceHub'
import { HttpMirrorRepository } from '@/data/device-mirror/HttpMirrorRepository'
import { WebCodecsVideoSink } from '@/data/device-mirror/WebCodecsVideoSink'
import { WebUsbMirrorRepository } from '@/data/device-mirror/webusb/WebUsbMirrorRepository'
import { HttpRemoteConfigRepository } from '@/data/remote-config/HttpRemoteConfigRepository'
import { HttpTranslationRepository } from '@/data/translation/HttpTranslationRepository'
import { HttpTranslationSettingsRepository } from '@/data/translation/HttpTranslationSettingsRepository'
import type { AdbAccess } from '@/domain/adb/entities/AdbAccess'
import type { AdbRepository } from '@/domain/adb/repositories/AdbRepository'
import type { MirrorRepository } from '@/domain/device-mirror/repositories/MirrorRepository'

/**
 * Composition root phía trình duyệt.
 *
 * Chỉ chứa những adapter nói chuyện qua HTTP. Không có Prisma, không có
 * credential, không có `server-only` — nếu một ngày file này lỡ import thứ gì
 * thuộc về server, build sẽ gãy ngay tại `server-only`.
 */
/**
 * MỘT sổ WebUSB cho cả tab, chia giữa logcat và mirror: một kết nối USB chỉ
 * một chỗ mở được, và mirror đẩy scrcpy-server lên đúng `Adb` mà logcat đang
 * đọc log — hai hub là hai kết nối tranh nhau một cổng.
 */
const webUsbHub = new WebUsbDeviceHub()

export const clientContainer = {
  remoteConfig: new HttpRemoteConfigRepository(),
  /** Cổng dịch chuỗi — gọi Route Handler, không bao giờ chạm tới khoá API. */
  translation: new HttpTranslationRepository(),
  /**
   * Cổng cấu hình mô hình. Khoá người dùng dán vào đi LÊN qua đây và không bao
   * giờ đi xuống lại — phản hồi chỉ mang bốn ký tự cuối.
   */
  translationSettings: new HttpTranslationSettingsRepository(),
  /**
   * Hai cổng adb, chọn theo `AdbAccess` mà trang truyền xuống (xem
   * `adbRepositoryFor`). `server` gọi Route Handler; `webusb` nói chuyện thẳng
   * với máy qua WebUSB và không cần máy chủ — đường duy nhất chạy trên Vercel.
   *
   * Cả hai là instance dùng chung cho cả tab: `webusb` giữ kết nối USB tới
   * từng máy, mà một kết nối chỉ một chỗ mở được, nên hai màn hình phải chia
   * nhau đúng một instance.
   */
  adb: {
    server: new HttpAdbRepository(),
    webusb: new WebUsbAdbRepository(webUsbHub),
  } satisfies Record<AdbAccess, AdbRepository>,
  deviceMirror: {
    /**
     * Hai cổng mirror, chọn theo cùng `AdbAccess` với logcat (xem
     * `mirrorRepositoryFor`): `server` gọi hai Route Handler `/api/adb/mirror/*`,
     * `webusb` chạy scrcpy ngay trong trình duyệt trên `Adb` của `webUsbHub`.
     */
    repositories: {
      server: new HttpMirrorRepository(),
      webusb: new WebUsbMirrorRepository(webUsbHub),
    } satisfies Record<AdbAccess, MirrorRepository>,
    /**
     * HÀM DỰNG, không phải instance — mỗi màn hình mirror cần `<canvas>` +
     * `VideoDecoder` RIÊNG của nó (dùng chung một sink giữa các lần mở màn
     * hình sẽ vẽ khung của phiên cũ lên canvas của phiên mới). Cùng lý do
     * `translatorFor` trong `di/server.ts` là hàm chứ không phải giá trị.
     */
    createVideoSink: () => new WebCodecsVideoSink(),
  },
} as const

export type ClientContainer = typeof clientContainer

export const adbRepositoryFor = (access: AdbAccess): AdbRepository => clientContainer.adb[access]
export const mirrorRepositoryFor = (access: AdbAccess): MirrorRepository => clientContainer.deviceMirror.repositories[access]
