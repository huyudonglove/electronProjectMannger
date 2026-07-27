import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

const root = process.cwd()
const staging = path.join(root, 'build', 'mac-app')
const desktop = path.join(root, 'apps', 'desktop')
const rootPackage = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
const desktopPackage = JSON.parse(await readFile(path.join(desktop, 'package.json'), 'utf8'))
const runtimePackageDirectories = [
  'project-core',
  'agent-core',
  'agent-config',
  'agent-credential-vault',
  'agent-desktop-config',
]
const runtimePackages = await Promise.all(runtimePackageDirectories.map(async (directory) => ({
  directory,
  root: path.join(root, 'packages', directory),
  manifest: JSON.parse(await readFile(path.join(root, 'packages', directory, 'package.json'), 'utf8')),
})))
const projectCorePackage = runtimePackages.find(({ directory }) => directory === 'project-core')?.manifest

if (rootPackage.version !== desktopPackage.version || rootPackage.version !== projectCorePackage?.version) {
  throw new Error('Workspace package versions must match before packaging')
}

await rm(staging, { recursive: true, force: true })
await mkdir(path.join(staging, 'node_modules', '@electron-manager'), { recursive: true })

await cp(path.join(desktop, 'dist'), path.join(staging, 'dist'), { recursive: true })
await cp(path.join(desktop, 'assets'), path.join(staging, 'assets'), { recursive: true })
await cp(path.join(desktop, 'renderer-vue'), path.join(staging, 'renderer-vue'), { recursive: true })
await cp(path.join(desktop, 'preload.cjs'), path.join(staging, 'preload.cjs'))

for (const runtimePackage of runtimePackages) {
  const target = path.join(staging, 'node_modules', '@electron-manager', runtimePackage.directory)
  await mkdir(target, { recursive: true })
  await cp(path.join(runtimePackage.root, 'dist'), path.join(target, 'dist'), { recursive: true })
  await writeFile(
    path.join(target, 'package.json'),
    `${JSON.stringify({
      name: runtimePackage.manifest.name,
      version: runtimePackage.manifest.version,
      private: true,
      type: runtimePackage.manifest.type,
      exports: runtimePackage.manifest.exports,
    }, null, 2)}\n`,
  )
}

await writeFile(
  path.join(staging, 'package.json'),
  `${JSON.stringify({
    name: 'electron-manager',
    version: rootPackage.version,
    private: true,
    type: 'module',
    main: 'dist/main.js',
    dependencies: Object.fromEntries(runtimePackages.map(({ manifest }) => [manifest.name, manifest.version])),
  }, null, 2)}\n`,
)
