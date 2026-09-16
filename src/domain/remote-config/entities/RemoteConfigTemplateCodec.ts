import { AppErrors, type Result, attempt, err, ok } from '../../../core/result'
import type { RemoteConfigTemplate } from './RemoteConfigTemplate'

/**
 * Đọc một template Remote Config đầy đủ từ tệp — thứ console Firebase xuất ra
 * qua "Download current template", hoặc thứ Admin API trả về khi GET.
 *
 * Khác với hai tài liệu `admob_id` / `config_show_ads`, template mang cả mảng
 * `conditions`. Đó là lý do đường nhập này tồn tại: nhập giá trị của một tham
 * số thì không cách nào mang theo điều kiện, vì trên Firebase điều kiện nằm ở
 * cấp project và giá trị chỉ tham chiếu tới tên của nó.
 *
 * Bộ đọc cố tình dễ dãi như `AdsDocumentCodec`: trường lạ được giữ nguyên.
 * Chỉ kiểm tra những gì tool này thật sự dựa vào — `conditions` phải là mảng
 * các điều kiện có tên và biểu thức, hai bảng tham số phải là đối tượng.
 */

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export function parseRemoteConfigTemplate(raw: string): Result<RemoteConfigTemplate> {
  if (raw.trim().length === 0) {
    return err(AppErrors.validation('Tệp template đang rỗng.'))
  }

  const parsed = attempt(() => JSON.parse(raw) as unknown, 'Tệp template không phải JSON hợp lệ.')
  if (!parsed.ok) {
    return err(
      AppErrors.validation('Tệp template không phải JSON hợp lệ.', {
        detail: parsed.error.detail ?? parsed.error.message,
      }),
    )
  }

  const body = parsed.value
  if (!isPlainObject(body)) {
    return err(AppErrors.validation('Tệp template phải là một đối tượng JSON.'))
  }

  // Nhầm tệp là lỗi hay gặp nhất: người dùng chọn nhầm file giá trị tham số.
  // Nói thẳng phải dùng nút nào thay vì báo "thiếu conditions" khó hiểu.
  if ('listConfig' in body || 'listAds' in body) {
    return err(
      AppErrors.validation(
        'Đây là nội dung của một tham số, không phải template. Dùng "Nhập config_show_ads.json" hoặc "Nhập admob_id.json" cho tệp này.',
      ),
    )
  }

  const { conditions, parameters, parameterGroups } = body
  if (conditions === undefined && parameters === undefined && parameterGroups === undefined) {
    return err(
      AppErrors.validation(
        'Tệp không có "parameters", "parameterGroups" hay "conditions" — không phải template Remote Config. Trên console: Remote Config → ⋮ → Download current template.',
      ),
    )
  }

  if (conditions !== undefined) {
    if (!Array.isArray(conditions)) {
      return err(AppErrors.validation('"conditions" trong template phải là một mảng.'))
    }
    for (const [index, condition] of conditions.entries()) {
      if (
        !isPlainObject(condition) ||
        typeof condition.name !== 'string' ||
        typeof condition.expression !== 'string'
      ) {
        return err(
          AppErrors.validation(
            `Điều kiện thứ ${index + 1} trong template thiếu "name" hoặc "expression".`,
          ),
        )
      }
    }
  }

  if (parameters !== undefined && !isPlainObject(parameters)) {
    return err(AppErrors.validation('"parameters" trong template phải là một đối tượng.'))
  }
  if (parameterGroups !== undefined && !isPlainObject(parameterGroups)) {
    return err(AppErrors.validation('"parameterGroups" trong template phải là một đối tượng.'))
  }

  return ok(body as RemoteConfigTemplate)
}
