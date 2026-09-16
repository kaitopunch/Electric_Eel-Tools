# Electric Eel — Bộ công cụ nội bộ Pion

Website nội bộ gom các công cụ mà đội làm app mobile của Pion dùng hàng ngày:
sửa Firebase Remote Config bằng biểu mẫu, dịch `strings.xml` sang nhiều ngôn
ngữ, xem logcat của riêng một app, quản lý tài khoản và phân quyền theo từng
project Firebase.

**Electric Eel** là tên của cả nền tảng; Remote Config chỉ là công cụ đầu tiên.
Công cụ mới đăng ký vào thanh điều hướng qua một bảng khai báo
(`src/ui/layout/toolRegistry.tsx`), không phải sửa layout.

---

## 1. Bài toán và giải pháp

### Bài toán

Cấu hình quảng cáo của mỗi app nằm trong hai tham số Remote Config `admob_id`
và `config_show_ads` — hai khối JSON hàng chục KB nằm gọn trên một dòng. Sửa
chúng trên Firebase Console có ba vấn đề:

- **Người mới không đọc được.** Không có cấu trúc, không có gợi ý, không biết
  trường nào là bắt buộc.
- **Người quen vẫn sai** theo những cách mắt người không bắt được: sai tên trường
  (Gson bỏ qua trong im lặng, app không báo lỗi), lệch tham chiếu giữa hai tham
  số, để sót ID quảng cáo thử lên production.
- **Không biết ai đổi gì.** Firebase Console không cho biết người nào publish
  bản nào, sửa trường gì.

Những việc khác trong ngày — dịch strings, lọc logcat — thì mỗi người một script
riêng, không ai kiểm được kết quả của ai.

### Giải pháp

Một website duy nhất, đăng nhập bằng tài khoản nội bộ, mỗi công cụ là một mục
trong thanh điều hướng:

| Công cụ | Làm gì | Dành cho |
|---|---|---|
| **Remote Config** | Nạp template từ Firebase, sửa bằng biểu mẫu, kiểm tra lỗi trước khi publish (tên trường, tham chiếu chéo, ID test), xem diff từng trường, hỗ trợ Firebase Conditions. Publish có ETag nên không đè lên bản người khác vừa đẩy. | Dev, QC, BA/PO, marketing |
| **Dịch** | Nạp `strings.xml`, dịch sang nhiều ngôn ngữ bằng OpenAI/Gemini (khoá API của từng người, mã hoá lưu trong DB), giữ nguyên placeholder và escape của Android, tải về một tệp zip. | Dev |
| **Logcat** | Chọn máy → chọn app → xem log của riêng app đó. Chạy ở máy dev thì dùng `adb` trên máy chủ; chạy trên Vercel thì trình duyệt nối thẳng điện thoại qua WebUSB. | Dev, QC |
| **Màn hình máy** | Mirror màn hình thiết bị qua scrcpy (chỉ khi chạy tại máy có `adb` + `scrcpy`). | Dev, QC |
| **Nhật ký** | Ai đổi gì, lúc nào, trên app nào — lọc và phân trang. | Admin |
| **Dự án / Tài khoản** | Thêm project Firebase (service account được mã hoá AES-256 trước khi lưu), phân quyền từng người trên từng app, tạo/khoá tài khoản. | Admin |

Điểm chung của mọi công cụ: **backend là bắt buộc**. Remote Config Admin API cần
OAuth2 service account và không hỗ trợ CORS, nên không làm được thuần frontend;
mọi lệnh gọi Firebase và mọi khoá bí mật đều ở phía server.

---

## 2. Công nghệ

| Thành phần | Bản | Ghi chú |
|---|---|---|
| Next.js | 16.3 | App Router, Turbopack, Server Actions + Route Handler |
| React | 19.2 | |
| MUI | 9.4 | Cộng lớp token Material 3 tự dựng — giao diện giống Android |
| Prisma | 7.10 | Driver adapter; SQLite khi dev, PostgreSQL (Neon) khi production |
| Auth.js | 5 beta | Đăng nhập Credentials, phiên JWT, tài khoản tự quản |
| Zustand | 5 | Bọc trong tầng MVI tự viết (Contract / ViewModel / Screen như Android) |
| TypeScript | 6.0 | |
| pnpm | 11 | |

Kiến trúc chia tầng `core → domain → data / ui → features → di → app`, ranh giới
do ESLint kiểm tra (`pnpm lint` chặn ngay khi `domain/` import React hay
`features/` import `data/`). Chi tiết ở `LLM.md` và `docs/architecture.md`
(hai file này nằm trong `.gitignore` — hỏi người trong nhóm nếu bạn cần).

---

## 3. Chạy tại máy (biến thể *debug*)

Dự án có hai biến thể cơ sở dữ liệu, đặt tên theo Android Studio:

| Biến thể | Lệnh | DB | File env |
|---|---|---|---|
| **debug** | `pnpm dev`, `pnpm db:*` | SQLite `dev.db` trong thư mục dự án | `.env.development` (được commit) |
| **release** | `pnpm build && pnpm start`, `pnpm *:release`, Vercel | PostgreSQL Neon | `.env.production` (không commit) |

Nhờ `.env.development` được commit, clone về là chạy được ngay mà không cần
tạo DB ở đâu cả.

### Yêu cầu

- Node.js ≥ 22 (dự án đang dùng 24), pnpm 11 — `corepack enable` là đủ
- `openssl` để sinh khoá (có sẵn trên macOS/Linux)
- Tuỳ chọn, chỉ cho Logcat/Mirror: `adb` (Android platform-tools), `scrcpy`
  (`brew install scrcpy`)

### Các bước

```bash
git clone https://github.com/kaitopunch/Electric_Eel-Tools.git
cd Electric_Eel-Tools
pnpm install
```

Tạo file `.env` ở thư mục gốc chứa bí mật dùng chung cho cả hai biến thể
(`.env.example` giải thích từng biến):

```bash
cat > .env <<EOF
AUTH_SECRET="$(openssl rand -base64 32)"
AUTH_URL="http://localhost:3000"
CREDENTIAL_ENCRYPTION_KEY="$(openssl rand -hex 32)"
SEED_ADMIN_EMAIL="admin@pion.local"
SEED_ADMIN_PASSWORD="$(openssl rand -base64 18)"
SEED_ADMIN_NAME="Quản trị viên"
EOF
cat .env   # ghi lại SEED_ADMIN_PASSWORD để đăng nhập
```

Dựng DB và tài khoản quản trị đầu tiên, rồi chạy:

```bash
pnpm db:push     # tạo bảng trong dev.db
pnpm db:seed     # tạo tài khoản admin từ SEED_ADMIN_*
pnpm dev         # http://localhost:3000
```

Đăng nhập bằng `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` (mật khẩu tối thiểu 10
ký tự), vào **Quản trị → Dự án** để thêm project Firebase: dán service account
JSON (tải từ Firebase Console → Project settings → Service accounts). Từ đó
Remote Config mới có app để mở.

Muốn DB sạch: xoá `dev.db` rồi chạy lại `pnpm db:push && pnpm db:seed`.

### Lệnh hay dùng

```bash
pnpm dev                 # chạy dev với hot reload
pnpm lint                # ESLint, gồm cả luật ranh giới tầng
pnpm typecheck           # tsc --noEmit
pnpm test                # node:test cho src/**/*.test.ts
pnpm db:studio           # Prisma Studio trên dev.db
pnpm validate:config     # kiểm tra tệp JSON config bằng đúng bộ luật của web
pnpm rotate:key          # xoay CREDENTIAL_ENCRYPTION_KEY (xem .env.example)
```

Thêm hậu tố `:release` (`db:push:release`, `db:seed:release`, `db:studio:release`,
`rotate:key:release`) để lệnh đó chạy trên DB production.

### Lưu ý theo công cụ

- **Logcat / Mirror tại máy:** mặc định `ADB_ENABLED` bật khi không phải
  production, tool sẽ gọi `adb` trên máy bạn. Đặt `ADB_PATH`, `AAPT2_PATH`,
  `SCRCPY_SERVER_PATH`, `SCRCPY_SERVER_VERSION` trong `.env` nếu không dò tự
  động được. `SCRCPY_SERVER_VERSION` phải khớp đúng bản `scrcpy` đã cài.
- **Dịch:** không có khoá API chung. Mỗi người tự dán khoá OpenAI/Gemini ở bước
  "Mô hình dịch" trên trang `/translations`; khoá được mã hoá và lưu theo tài
  khoản.

---

## 4. Deploy lên Vercel (biến thể *release*)

Vercel là môi trường serverless: đĩa chỉ đọc, mỗi request có thể là một tiến
trình mới. Vì thế **production bắt buộc dùng PostgreSQL**, không dùng SQLite.
Dự án đã cấu hình region `sin1` (Singapore) trong `vercel.json`.

### Bước 1 — Tạo database Neon

1. Tạo project tại [neon.tech](https://neon.tech) (free tier đủ dùng).
2. Lấy **connection string có `-pooler` trong host** (chọn *Pooled connection*
   trong bảng điều khiển của Neon). Serverless mở kết nối liên tục; không đi
   qua pooler thì free tier hết kết nối rất nhanh.

### Bước 2 — Dựng bảng và tài khoản admin lên Neon

Chạy một lần từ máy bạn. Tạo `.env.production` (file này bị gitignore, đừng
commit):

```bash
cat > .env.production <<EOF
DATABASE_URL="postgresql://...-pooler.../neondb?sslmode=require"
EOF

pnpm db:push:release
pnpm db:seed:release      # dùng SEED_ADMIN_* trong .env — đổi mật khẩu khác dev!
```

Trước khi seed, hãy đặt `SEED_ADMIN_PASSWORD` trong `.env` thành một mật khẩu
mới dành riêng cho production (mật khẩu này chỉ dùng cho lệnh seed, Vercel
không cần biết).

Muốn thử đúng bản production tại máy trước khi deploy:

```bash
pnpm build && pnpm start   # dùng .env.production → Neon
```

### Bước 3 — Tạo project trên Vercel

1. Vercel → **Add New → Project** → import repo GitHub này.
2. Framework preset: **Next.js** (tự nhận). Build command giữ mặc định — script
   `build` trong `package.json` đã có `prisma generate`, đừng bỏ vì
   `src/generated/` không nằm trong git.
3. Package manager: Vercel đọc `packageManager: pnpm@11` trong `package.json`.

### Bước 4 — Biến môi trường (Settings → Environment Variables)

Vercel **không đọc** `.env.production` trong repo; mọi biến phải khai ở đây,
cho môi trường **Production** (và Preview nếu muốn):

| Biến | Giá trị | Bắt buộc |
|---|---|---|
| `DATABASE_URL` | Chuỗi Neon có `-pooler` | ✅ — thiếu là server từ chối khởi động |
| `AUTH_SECRET` | `openssl rand -base64 32` — **phải khác** khoá dev | ✅ |
| `AUTH_URL` | `https://<tên-miền-của-bạn>` — phải là https | ✅ |
| `CREDENTIAL_ENCRYPTION_KEY` | `openssl rand -hex 32` — 64 ký tự hex | ✅ — mất khoá là mất mọi service account đã lưu |
| `ADB_ENABLED` | để trống (mặc định tắt ở production → Logcat dùng WebUSB) | không |
| `OPENAI_*`, `GEMINI_*`, `CHUNK_*`, `MAX_CONCURRENT_TRANSLATIONS`, … | tuỳ chỉnh, có mặc định trong code | không |

`src/instrumentation.ts` kiểm tra bốn biến bắt buộc lúc khởi động và **từ chối
chạy** nếu thiếu — để lộ lỗi sớm thay vì vài tuần sau khi admin gắn service
account. Lỗi hiện trong Vercel → Deployments → Runtime Logs.

Lưu `AUTH_SECRET` và `CREDENTIAL_ENCRYPTION_KEY` vào password manager của nhóm.
Đổi `AUTH_SECRET` = mọi người bị đăng xuất; đổi `CREDENTIAL_ENCRYPTION_KEY` mà
không chạy `pnpm rotate:key:release` = không giải mã được service account nào.

### Bước 5 — Deploy và kiểm tra

1. **Deploy**. Từ đó mỗi lần push lên nhánh production là tự deploy; push nhánh
   khác thì ra Preview deployment.
2. Mở tên miền, đăng nhập bằng tài khoản seed ở bước 2, vào **Quản trị → Dự án**
   thêm project Firebase.
3. Kiểm tra Runtime Logs không có dòng cảnh báo về biến môi trường.

### Những gì khác giữa Vercel và chạy tại máy

| | Tại máy | Vercel |
|---|---|---|
| Logcat | `adb` trên máy chủ | WebUSB — trình duyệt Chrome/Edge nối thẳng điện thoại cắm vào máy người dùng; người dùng phải `adb kill-server` nếu Android Studio đang giữ USB; không hiện tên app (cần `aapt2`) |
| Màn hình máy (mirror) | scrcpy trên máy chủ | Chưa hỗ trợ — mục vẫn hiện nhưng không chạy được |
| Dịch | Route `/api/translations` có `maxDuration = 300` | Một lượt dịch dài bị cắt ở 300 giây; giảm `MAX_CONCURRENT_TRANSLATIONS` hoặc chia nhỏ tệp nếu bị đứt |
| DB | SQLite, xoá file là sạch | Neon; dùng `pnpm db:studio:release` từ máy để xem dữ liệu |

---

## 5. Cấu trúc thư mục rút gọn

```
src/
├── core/        Result/AppError, tầng MVI (createViewModel, EffectChannel), tiện ích thuần
├── domain/      thực thể, cổng (interface), use case, bộ luật kiểm tra — không phụ thuộc framework
│   ├── ads/            Remote Config: codec JSON, workspace theo Conditions, diff, validation rules
│   ├── translation/    dịch strings.xml: chia mẻ, giữ nhịp theo hạn mức, thử lại
│   ├── adb/            logcat, danh sách package, đường server/webusb
│   ├── device-mirror/  scrcpy
│   ├── remote-config/  template Firebase + ConditionExpression
│   └── identity/       tài khoản, vai trò, chính sách mật khẩu, rate limit
├── data/        adapter thật: Firebase REST, Prisma, adb, OpenAI/Gemini
├── ui/          design system M3 dùng chung + toolRegistry (thanh điều hướng)
├── features/    Contract + ViewModel + Screen của từng màn
├── di/          composition root — nơi duy nhất nối domain với data
├── lib/         auth, env, session (server-only)
└── app/         route, layout, Route Handler — mỏng
prisma/          schema.prisma (một bản gốc, provider đổi tự động cho SQLite) + seed.ts
scripts/         load-env, xoay khoá, sinh template/palette
tools/           validate-config.ts — CLI kiểm tra JSON config
```

---

## 6. Bảo mật — những điều đã cố ý làm

- Service account Firebase mã hoá AES-256-GCM bằng `CREDENTIAL_ENCRYPTION_KEY`
  trước khi vào DB; có quy trình xoay khoá (`pnpm rotate:key`).
- Khoá API dịch của mỗi người mã hoá riêng, không có khoá dùng chung.
- CSP chặn nạp script từ máy chủ ngoài, `frame-ancestors 'none'` + `X-Frame-Options: DENY`
  chống clickjacking nút publish; HSTS chỉ bật ở production.
- Publish Remote Config có ETag: đẩy đè lên bản người khác vừa publish sẽ bị từ chối.
- Mọi thao tác publish, tạo/khoá tài khoản, gắn service account đều ghi Nhật ký.
- Không commit `.env`, `.env.local`, `.env.production`, `*service-account*.json`, `*.db`.
