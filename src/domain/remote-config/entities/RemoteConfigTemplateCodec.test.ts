import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { parseRemoteConfigTemplate } from './RemoteConfigTemplateCodec'

describe('parseRemoteConfigTemplate', () => {
  it('đọc template tải từ console và giữ nguyên trường lạ', () => {
    const raw = JSON.stringify({
      conditions: [{ name: 'Việt Nam', expression: "device.country in ['VN']", tagColor: 'BLUE' }],
      parameters: { admob_id: { defaultValue: { value: '{}' }, valueType: 'JSON' } },
      version: { versionNumber: '12' },
      etag: 'etag-12',
      _comment: 'ghi chú của ai đó',
    })

    const parsed = parseRemoteConfigTemplate(raw)
    assert.ok(parsed.ok)
    assert.equal(parsed.value.conditions?.length, 1)
    assert.equal((parsed.value as Record<string, unknown>)._comment, 'ghi chú của ai đó')
  })

  it('chỉ ra đúng nút phải dùng khi chọn nhầm tệp giá trị tham số', () => {
    const parsed = parseRemoteConfigTemplate('{"listConfig": []}')
    assert.ok(!parsed.ok)
    assert.equal(parsed.error.kind, 'validation')
    assert.match(parsed.error.message, /Nhập config_show_ads\.json/)
  })

  it('từ chối JSON không phải template', () => {
    for (const raw of ['', 'not json', '[]', '{"foo": 1}', '{"conditions": {}}', '{"conditions": [{"name": "x"}]}']) {
      const parsed = parseRemoteConfigTemplate(raw)
      assert.ok(!parsed.ok, raw)
      assert.equal(parsed.error.kind, 'validation')
    }
  })
})
