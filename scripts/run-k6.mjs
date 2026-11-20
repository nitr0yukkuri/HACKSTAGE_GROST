import { spawnSync } from 'node:child_process'

const profile = process.argv[2]
if (!['smoke', 'load'].includes(profile)) {
  process.stderr.write('使い方: node scripts/run-k6.mjs smoke|load\n')
  process.exit(2)
}

const executable = process.platform === 'win32' ? 'k6.exe' : 'k6'
const result = spawnSync(executable, ['run', 'tests/k6/discovery.js'], {
  env: { ...process.env, K6_PROFILE: profile },
  stdio: 'inherit',
})

if (result.error?.code === 'ENOENT') {
  process.stderr.write('k6 が見つかりません。Grafana k6 をインストールして PATH に追加してください。\n')
  process.exit(127)
}
process.exit(result.status ?? 1)
