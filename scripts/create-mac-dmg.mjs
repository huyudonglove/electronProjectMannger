import { mkdir, readFile, rm, stat, symlink } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import path from 'node:path'

const root = process.cwd()
const packageJson = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
const releaseDir = path.join(root, 'release')
const appPath = path.join(releaseDir, 'mac-arm64', 'Electron Manager.app')
const tempDmgPath = path.join(root, 'build', 'Electron Manager-temp.dmg')
const mountPoint = path.join(root, 'build', 'dmg-mount')
const dmgPath = path.join(releaseDir, `Electron Manager-${packageJson.version}-arm64.dmg`)

async function ensureExists(filePath, label) {
  try {
    await stat(filePath)
  } catch {
    throw new Error(`${label} not found: ${filePath}`)
  }
}

function formatCommand(command, args) {
  return [command, ...args.map((arg) => /\s/.test(arg) ? JSON.stringify(arg) : arg)].join(' ')
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8' })

  if (options.printOutput !== false) {
    if (result.stdout) process.stdout.write(result.stdout)
    if (result.stderr) process.stderr.write(result.stderr)
  }

  if (result.status !== 0) {
    const details = [
      `${formatCommand(command, args)} failed with exit code ${result.status}`,
      result.stdout ? `stdout:\n${result.stdout.trimEnd()}` : '',
      result.stderr ? `stderr:\n${result.stderr.trimEnd()}` : '',
    ].filter(Boolean).join('\n')
    throw new Error(details)
  }

  return result
}

function output(command, args) {
  return run(command, args, { printOutput: false }).stdout.trim()
}

function parseAttachDevice(plist) {
  const entities = plist.split(/<dict>/g).slice(1)
  for (const entity of entities) {
    if (!entity.includes('<key>dev-entry</key>')) continue
    if (!entity.includes(`<string>${mountPoint}</string>`)) continue
    return entity.match(/<key>dev-entry<\/key>\s*<string>([^<]+)<\/string>/)?.[1] || ''
  }
  return plist.match(/<key>dev-entry<\/key>\s*<string>([^<]+)<\/string>/)?.[1] || ''
}

function detach(target, force = false) {
  const args = ['detach', target, '-quiet']
  if (force) args.push('-force')
  return run('hdiutil', args)
}

await ensureExists(appPath, 'macOS app bundle')

const appSizeKb = Number(output('du', ['-sk', appPath]).split(/\s+/)[0])
const imageSizeMb = Math.ceil(appSizeKb / 1024 * 1.75 + 192)

await rm(dmgPath, { force: true })
await rm(tempDmgPath, { force: true })
await rm(mountPoint, { recursive: true, force: true })
await mkdir(mountPoint, { recursive: true })

let attached = false
let attachedDevice = ''

try {
  run('hdiutil', [
    'create',
    '-volname',
    'Electron Manager',
    '-size',
    `${imageSizeMb}m`,
    '-fs',
    'APFS',
    '-layout',
    'GPTSPUD',
    tempDmgPath,
  ])

  const attachResult = run('hdiutil', [
    'attach',
    tempDmgPath,
    '-mountpoint',
    mountPoint,
    '-nobrowse',
    '-plist',
  ])
  attachedDevice = parseAttachDevice(attachResult.stdout)
  attached = true

  run('ditto', [
    '--noextattr',
    '--noqtn',
    '--noacl',
    '--nopreserveHFSCompression',
    appPath,
    path.join(mountPoint, 'Electron Manager.app'),
  ])
  await symlink('/Applications', path.join(mountPoint, 'Applications'))

  try {
    detach(attachedDevice || mountPoint)
  } catch {
    detach(attachedDevice || mountPoint, true)
  }
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
  run('xattr', ['-cr', dmgPath])
} finally {
  if (attached) {
    spawnSync('hdiutil', ['detach', attachedDevice || mountPoint, '-force', '-quiet'], { stdio: 'ignore' })
  }

  await rm(tempDmgPath, { force: true })
  await rm(mountPoint, { recursive: true, force: true })
}
