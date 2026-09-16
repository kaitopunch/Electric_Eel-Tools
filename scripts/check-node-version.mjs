// Chạy trước `pnpm dev` / `pnpm build`. Chặn sớm với thông báo rõ ràng thay vì
// để better-sqlite3 (native) chết với ERR_DLOPEN_FAILED ở tận lúc đăng nhập.
//
// `engine-strict` trong .npmrc chỉ kiểm lúc `pnpm install`; brew nâng Node sau
// đó thì không ai kiểm — đây là chỗ bù. Nguồn sự thật duy nhất: engines.node
// trong package.json, khớp với bản Vercel dùng để build.
import { readFileSync } from 'node:fs'

const { engines } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const wanted = Number.parseInt(engines.node, 10)
const actual = Number.parseInt(process.versions.node, 10)

if (wanted !== actual) {
  console.error(
    `Node ${process.versions.node} không khớp engines.node = "${engines.node}" (Vercel build bằng bản này).\n` +
      `  brew install node@${wanted} && brew unlink node && brew link --overwrite --force node@${wanted}\n` +
      `  pnpm rebuild better-sqlite3   # module native phải biên dịch lại theo Node mới`,
  )
  process.exit(1)
}
