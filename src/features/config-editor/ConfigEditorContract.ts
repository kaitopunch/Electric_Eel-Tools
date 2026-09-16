import type { AppError } from '@/core/result'
import { isOfflineWorkspace } from '@/domain/ads/AdsWorkspace'
import type { AdsWorkspace } from '@/domain/ads/AdsWorkspace'
import type { ParameterName } from '@/domain/ads/WorkspaceEdits'
import type { AdUnit } from '@/domain/ads/entities/AdmobIdDocument'
import type { AdPlacement } from '@/domain/ads/entities/ShowAdsDocument'
import type { Severity } from '@/domain/ads/validation/Finding'
import type { RemoteConfigCondition } from '@/domain/remote-config/entities/RemoteConfigTemplate'

/**
 * Hợp đồng của màn soạn cấu hình quảng cáo.
 *
 * State, Intent và Effect nằm ở đây và CHỈ ở đây — không khai rải rác trong
 * file ViewModel. Đọc một file này là biết màn hình có thể ở những trạng thái
 * nào, nhận được những yêu cầu nào, và phát ra những việc gì.
 *
 *   State  — thứ màn hình vẽ ra. Không chứa hàm, không chứa lớp.
 *   Intent — mọi thứ có thể yêu cầu ViewModel làm. Đường vào duy nhất.
 *   Effect — việc xảy ra một lần: điều hướng, thông báo, tải tệp về.
 */

// ─── State ──────────────────────────────────────────────────────────────────

export type EditorStatus = 'idle' | 'loading' | 'ready' | 'failed'

/** Bộ lọc danh sách vị trí. Cố ý tách khỏi ô tìm kiếm: hai thứ dùng khác nhau. */
export type PlacementFilter = 'all' | 'enabled' | 'disabled' | 'withFindings'

export const PLACEMENT_FILTER_LABEL: Record<PlacementFilter, string> = {
  all: 'Tất cả',
  enabled: 'Đang bật',
  disabled: 'Đang tắt',
  withFindings: 'Có vấn đề',
}

export type EditorTab = 'placements' | 'adUnits' | 'global' | 'conditions'

export interface ConfigEditorState {
  readonly appSlug: string
  readonly status: EditorStatus
  readonly error: AppError | null

  /**
   * Bản tải về từ Firebase, giữ nguyên không sửa. Dùng để dựng bản so sánh và
   * để khôi phục khi người dùng huỷ bỏ thay đổi.
   */
  readonly original: AdsWorkspace | null
  /** Bản đang sửa. */
  readonly draft: AdsWorkspace | null

  /** Biến thể đang xem. `null` là giá trị mặc định. */
  readonly selectedCondition: string | null
  readonly tab: EditorTab
  readonly selectedPlacement: string | null
  readonly search: string
  readonly filter: PlacementFilter

  readonly publishing: boolean
  /** Người dùng đã đọc và chấp nhận các cảnh báo. */
  readonly warningsAcknowledged: boolean
  /** Thời điểm publish thành công gần nhất, để hiện thông báo. */
  readonly publishedAt: number | null
}

export const initialConfigEditorState = (appSlug: string): ConfigEditorState => ({
  appSlug,
  status: 'idle',
  error: null,
  original: null,
  draft: null,
  selectedCondition: null,
  tab: 'placements',
  selectedPlacement: null,
  search: '',
  filter: 'all',
  publishing: false,
  warningsAcknowledged: false,
  publishedAt: null,
})

// ─── Intent ─────────────────────────────────────────────────────────────────

export type ConfigEditorIntent =
  | { type: 'Load' }
  | { type: 'Reload' }
  | { type: 'DiscardChanges' }

  // Điều hướng trong màn hình
  | { type: 'TabSelected'; tab: EditorTab }
  | { type: 'ConditionSelected'; conditionName: string | null }
  | { type: 'PlacementSelected'; configName: string | null }
  | { type: 'SearchChanged'; value: string }
  | { type: 'FilterChanged'; filter: PlacementFilter }

  // Sửa vị trí quảng cáo
  | { type: 'PlacementChanged'; configName: string; patch: Partial<AdPlacement> }
  | { type: 'PlacementFieldCleared'; configName: string; field: string }
  | { type: 'PlacementAdded'; placement: AdPlacement }
  | { type: 'PlacementRemoved'; configName: string }

  // Sửa ad unit
  | { type: 'AdUnitChanged'; spaceName: string; patch: Partial<AdUnit> }
  | { type: 'AdUnitAdded'; unit: AdUnit }
  | { type: 'AdUnitRemoved'; spaceName: string }

  // Sửa trường cấp gốc
  | { type: 'ShowAdsRootChanged'; field: string; value: unknown }
  /** Sửa nhanh cho ROOT_FIELD_RENAMED: đổi tên khoá sai, giữ nguyên giá trị. */
  | { type: 'ShowAdsRootFieldRenamed'; from: string; to: string }
  | { type: 'AdmobRootChanged'; field: string; value: unknown }

  // Điều kiện và biến thể
  | { type: 'ConditionSaved'; condition: RemoteConfigCondition; previousName?: string }
  | { type: 'ConditionRemoved'; name: string }
  | { type: 'ConditionMoved'; from: number; to: number }
  | { type: 'OverrideCreated'; parameter: ParameterName; conditionName: string }
  | { type: 'OverrideCleared'; parameter: ParameterName; conditionName: string }

  // Nhập / xuất
  | { type: 'RawImported'; parameter: ParameterName; raw: string }
  /**
   * Nạp cả template Remote Config (tệp "Download current template" của console,
   * có `conditions`). Thay toàn bộ bản gốc lẫn bản nháp; bản nhập không có ETag
   * nên chỉ xem và xuất, không đẩy lên được — xem `isOfflineDraft`.
   */
  | { type: 'TemplateImported'; raw: string }
  | { type: 'ExportRequested'; parameter: ParameterName }

  // Đẩy lên Firebase
  | { type: 'WarningsAcknowledged'; value: boolean }
  | { type: 'PublishRequested' }

// ─── Effect ─────────────────────────────────────────────────────────────────

export type ConfigEditorEffect =
  | { type: 'ShowMessage'; severity: Severity | 'success'; message: string }
  | { type: 'DownloadFile'; fileName: string; content: string }
  /** Publish xong: đóng hộp thoại so sánh và cuộn lên đầu. */
  | { type: 'PublishSucceeded' }

// ─── Dẫn xuất từ state ──────────────────────────────────────────────────────
//
// Để ở đây thay vì tính trong component: đây là quy tắc nghiệp vụ, không phải
// chuyện trình bày, và cần kiểm thử được mà không cần render gì.

/** Biến thể đang xem, sau khi rơi về mặc định nếu điều kiện chưa có giá trị riêng. */
export function currentResolved(state: ConfigEditorState) {
  const workspace = state.draft
  if (workspace === null) return null
  return (
    workspace.resolved.find((variant) => variant.conditionName === state.selectedCondition) ??
    workspace.resolved[0] ??
    null
  )
}

/**
 * Bản nháp dựng từ tệp chứ không phải từ Firebase. Không có ETag nên không
 * đẩy lên được; muốn về bản trên Firebase thì Tải lại.
 */
export const isOfflineDraft = (state: ConfigEditorState): boolean =>
  state.draft !== null && isOfflineWorkspace(state.draft)

export const hasUnsavedChanges = (state: ConfigEditorState): boolean => {
  if (state.original === null || state.draft === null) return false
  return (
    state.original.showAds.variants.map((variant) => variant.raw).join('\0') !==
      state.draft.showAds.variants.map((variant) => variant.raw).join('\0') ||
    state.original.admob.variants.map((variant) => variant.raw).join('\0') !==
      state.draft.admob.variants.map((variant) => variant.raw).join('\0') ||
    JSON.stringify(state.original.conditions) !== JSON.stringify(state.draft.conditions)
  )
}

/** Lọc danh sách vị trí theo ô tìm kiếm và bộ lọc đang chọn. */
export function visiblePlacements(state: ConfigEditorState): AdPlacement[] {
  const resolved = currentResolved(state)
  const placements = resolved?.showAds?.listConfig ?? []
  const query = state.search.trim().toLowerCase()

  const flagged = new Set(
    (resolved?.validation.findings ?? [])
      .filter((finding) => finding.path.scope === 'placement')
      .map((finding) => (finding.path as { configName: string }).configName),
  )

  return placements.filter((placement) => {
    if (query.length > 0 && !placement.configName.toLowerCase().includes(query)) return false
    switch (state.filter) {
      case 'enabled':
        return placement.isOn === true
      case 'disabled':
        return placement.isOn !== true
      case 'withFindings':
        return flagged.has(placement.configName)
      case 'all':
        return true
    }
  })
}
