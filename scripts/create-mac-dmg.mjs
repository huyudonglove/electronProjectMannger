import { mkdir, readFile, rm, symlink } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import path from 'node:path'

const root = process.cwd()
const packageJson = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
const releaseDir = path.join(root, 'release')
const appPath = path.join(releaseDir, 'mac-arm64', 'Electron Manager.app')
const tempDmgPath = path.join(root, 'build', 'Electron Manager-temp.dmg')
const mountPoint = path.join(root, 'build', 'dmg-mount')
const dmgPath = path.join(releaseDir, `Electron Manager-${packageJson.version}-arm64.dmg`)

function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit' })

  if (result.status !== 0) {
    throw new Error(`${command} failed with exit code ${result.status}`)
  }
}

function output(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8' })

  if (result.status !== 0) {
    throw new Error(`${command} failed with exit code ${result.status}`)
  }

  return result.stdout.trim()
}

const appSizeKb = Number(output('du', ['-sk', appPath]).split(/\s+/)[0])
const imageSizeMb = Math.ceil(appSizeKb / 1024 * 1.35 + 128)

await rm(dmgPath, { force: true })
await rm(tempDmgPath, { force: true })
await rm(mountPoint, { recursive: true, force: true })
await mkdir(mountPoint, { recursive: true })

let attached = false

try {
  run('hdiutil', [
    'create',
    '-volname',
    'Electron Manager',
    '-size',
    `${imageSizeMb}m`,
    '-fs',
    'HFS+',
    '-layout',
    'SPUD',
    tempDmgPath,
  ])

  run('hdiutil', [
    'attach',
    tempDmgPath,
    '-mountpoint',
    mountPoint,
    '-nobrowse',
    '-quiet',
  ])
  attached = true

  run('ditto', [appPath, path.join(mountPoint, 'Electron Manager.app')])
  await symlink('/Applications', path.join(mountPoint, 'Applications'))

  run('hdiutil', ['detach', mountPoint, '-quiet'])
  attached = false

  run('hdiutil', [
    'convert',
    tempDmgPath,
    '-format',
    'UDZO',
    '-imagekey',
    'zlib-level=9',
    '-o',
    dmgPath,
  ])
} finally {
  if (attached) {
    spawnSync('hdiutil', ['detach', mountPoint, '-force', '-quiet'], { stdio: 'ignore' })
  }

  await rm(tempDmgPath, { force: true })
  await rm(mountPoint, { recursive: true, force: true })
}
