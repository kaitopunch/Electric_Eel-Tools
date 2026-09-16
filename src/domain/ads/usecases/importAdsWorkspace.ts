import { type Result, ok } from '../../../core/result'
import { parseRemoteConfigTemplate } from '../../remote-config/entities/RemoteConfigTemplateCodec'
import { OFFLINE_ETAG, buildAdsWorkspace } from '../AdsWorkspace'
import type { AdsWorkspace } from '../AdsWorkspace'

/**
 * Dựng không gian làm việc từ một template tải về dưới dạng tệp.
 *
 * Dành cho lúc không nối được Firebase — app chưa có service account, hoặc
 * muốn xem một bản offline. Đi qua đúng `buildAdsWorkspace` như đường tải từ
 * Firebase nên điều kiện, biến thể và bộ kiểm tra đều chạy y hệt; chỉ khác là
 * không có ETag, và vì thế `publishAdsWorkspace` từ chối bản này.
 */
export function importAdsWorkspace(params: { appSlug: string; raw: string }): Result<AdsWorkspace> {
  const parsed = parseRemoteConfigTemplate(params.raw)
  if (!parsed.ok) return parsed
  return ok(buildAdsWorkspace(params.appSlug, parsed.value, OFFLINE_ETAG))
}
