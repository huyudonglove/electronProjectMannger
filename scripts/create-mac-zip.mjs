import { readFile, rm } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import path from 'node:path'

const root = process.cwd()
const packageJson = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
const releaseDir = path.join(root, 'release')
const appDir = path.join(releaseDir, 'mac-arm64')
const zipPath = path.join(releaseDir, `Electron Manager-${packageJson.version}-arm64.zip`)

await rm(zipPath, { force: true })
await rm(`${zipPath}.blockmap`, { force: true })

const result = spawnSync('ditto', [
  '-c',
  '-k',
  '--sequesterRsrc',
  '--keepParent',
  path.join(appDir, 'Electron Manager.app'),
  zipPath,
], {
  stdio: 'inherit',
})

if (result.status !== 0) {
  throw new Error(`ditto failed with exit code ${result.status}`)
}
