/**
 * Hai hằng về `scrcpy-server` mà CẢ HAI đường mirror cùng đọc — không có
 * `node:*` ở đây để trình duyệt (đường WebUSB) import được.
 *
 * Bản phải khớp ĐÚNG với tệp jar, ở cả hai chỗ:
 *   · máy chủ: `SCRCPY_SERVER_PATH` (mặc định là jar của `brew install scrcpy`),
 *     ghi đè được bằng `SCRCPY_SERVER_VERSION` — xem `mirrorSettings.ts`;
 *   · trình duyệt: `public/scrcpy-server` (sao chép từ chính jar của brew),
 *     KHÔNG ghi đè được — trình duyệt không có `.env`.
 * Lệch bản là scrcpy-server tự thoát ngay khi start với dòng "does not match".
 * `brew upgrade scrcpy` thì đổi số này VÀ chép lại tệp trong `public/`
 * (`scrcpyServer.test.ts` bắt trường hợp quên chép).
 */
export const SCRCPY_SERVER_VERSION = '3.3.4'

/** Đường dẫn công khai của jar cho đường WebUSB — tệp tĩnh trong `public/`, cùng gốc nên qua được `connect-src 'self'`. */
export const SCRCPY_SERVER_PUBLIC_PATH = '/scrcpy-server'

/**
 * Câu báo dùng chung cho MỌI chỗ không tìm thấy jar trên máy chủ — kể cả lượt
 * kiểm lại của `jarSource.ts`/`mirrorFailure.ts` lúc đẩy jar thật lên máy
 * (TOCTOU: file bị xoá giữa lúc đọc settings và lúc dùng). Một câu, một chỗ sửa.
 */
export const SCRCPY_JAR_NOT_FOUND_MESSAGE =
  'Chưa có scrcpy-server trên máy chủ. Cài `brew install scrcpy` rồi đặt SCRCPY_SERVER_PATH=/opt/homebrew/share/scrcpy/scrcpy-server trong .env.'

/** Jar có nhưng máy chủ không đọc được — đường dẫn thật đi trong `detail` (chỉ ghi log máy chủ). */
export const JAR_UNREADABLE_MESSAGE =
  'Máy chủ không có quyền đọc scrcpy-server. Kiểm tra quyền đọc của tệp tại SCRCPY_SERVER_PATH.'
