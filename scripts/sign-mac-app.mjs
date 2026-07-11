import { spawnSync } from 'node:child_process'
import path from 'node:path'

const root = process.cwd()
const appPath = process.argv[2] ?? path.join(root, 'release', 'mac-arm64', 'Electron Manager.app')

function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit' })

  if (result.status !== 0) {
    throw new Error(`${command} failed with exit code ${result.status}`)
  }
}

run('xattr', ['-cr', appPath])
run('codesign', ['--force', '--deep', '--sign', '-', '--timestamp=none', appPath])
run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath])
run('xattr', ['-cr', appPath])
