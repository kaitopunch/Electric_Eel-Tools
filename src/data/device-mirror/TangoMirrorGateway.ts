import 'server-only'

import { type Adb, AdbServerClient } from '@yume-chan/adb'
import { AdbServerNodeTcpConnector } from '@yume-chan/adb-server-node-tcp'

import { type Result, err } from '../../core/result'
import type { AdbShell } from '../../domain/adb/repositories/AdbShell'
import type { MirrorRequest } from '../../domain/device-mirror/entities/MirrorRequest'
import type {
  MirrorDeviceGateway,
  MirrorDeviceSession,
} from '../../domain/device-mirror/repositories/MirrorDeviceGateway'
import { openJarStream } from './jarSource'
import { describeMirrorFailure } from './mirrorFailure'
import type { MirrorSettings } from './mirrorSettings'
import { closeTangoResources } from './tangoSession'
import { raceAbort, startTangoSession } from './tangoStart'

/**
 * Hiện thực phía MÁY CHỦ của cổng mirror — dựng một phiên scrcpy trên máy
 * đang cắm qua adb server, bằng thư viện Tango (`@yume-chan/*`).
 *
 * Phần bắt tay scrcpy (đẩy jar, start, chờ video) nằm ở `tangoStart.ts` và
 * dùng chung với đường WebUSB; ở đây chỉ còn hai việc riêng của máy chủ: mở
 * `Adb` qua TCP tới adb server, và đọc jar từ đĩa.
 *
 * Ngoại lệ có chủ ý so với `ProcessAdbShell` (mỗi lệnh sống, chết trong đúng
 * một request): một phiên scrcpy PHẢI sống lâu hơn một lượt gọi hàm, vì trình
 * duyệt cần gửi điều khiển (route `/control`) tới ĐÚNG phiên `/stream` đang
 * chảy — HTTP/1.1 không mở được kênh nhị phân hai chiều trên một request.
 * Điều KHÔNG đổi: phiên vẫn thuộc đúng MỘT request đã tạo ra nó.
 * `MirrorSessionRegistry` chỉ giữ tham chiếu để route `/control` tra cứu,
 * không sở hữu vòng đời — route `/stream` luôn `release()` + `close()` trong
 * `finally` của chính nó (xem `LLM.md` §12).
 */
export class TangoMirrorGateway implements MirrorDeviceGateway {
  constructor(
    private readonly shell: AdbShell,
    private readonly settings: () => Result<MirrorSettings>,
    private readonly adbPort: number = Number(process.env.ANDROID_ADB_SERVER_PORT ?? 5037),
  ) {}

  async start(request: MirrorRequest, signal: AbortSignal): Promise<Result<MirrorDeviceSession>> {
    const settingsResult = this.settings()
    if (!settingsResult.ok) return settingsResult
    const { jarPath, version } = settingsResult.value

    // Đảm bảo adb server đang chạy TRƯỚC khi Tango tự nối TCP tới nó — thiếu
    // bước này thì lỗi đầu tiên là một `ECONNREFUSED` khó hiểu.
    const adbStarted = await this.shell.run({ args: ['start-server'], timeoutMs: 10_000 }, signal)
    if (!adbStarted.ok) return adbStarted

    let adb: Adb
    try {
      const connector = new AdbServerNodeTcpConnector({ host: '127.0.0.1', port: this.adbPort })
      const client = new AdbServerClient(connector)
      adb = await raceAbort(client.createAdb({ serial: request.serial }), signal, 'adb server')
    } catch (thrown) {
      return err(describeMirrorFailure(thrown, [], jarPath, version))
    }

    const jar = openJarStream(jarPath)
    if (!jar.ok) {
      await closeTangoResources(undefined, adb)
      return jar
    }

    // Máy chủ mở `Adb` riêng cho phiên này → phiên sở hữu và đóng nó cùng mình.
    return startTangoSession({ adb, ownsAdb: true, jar: jar.value, jarSource: jarPath, version, request }, signal)
  }
}
