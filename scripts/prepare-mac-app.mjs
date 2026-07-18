import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

const root = process.cwd()
const staging = path.join(root, 'build', 'mac-app')
const desktop = path.join(root, 'apps', 'desktop')
const projectCore = path.join(root, 'packages', 'project-core')
const rootPackage = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
const desktopPackage = JSON.parse(await readFile(path.join(desktop, 'package.json'), 'utf8'))
const projectCorePackage = JSON.parse(await readFile(path.join(projectCore, 'package.json'), 'utf8'))

if (rootPackage.version !== desktopPackage.version || rootPackage.version !== projectCorePackage.version) {
  throw new Error('Workspace package versions must match before packaging')
}

await rm(staging, { recursive: true, force: true })
await mkdir(path.join(staging, 'node_modules', '@electron-manager'), { recursive: true })

await cp(path.join(desktop, 'dist'), path.join(staging, 'dist'), { recursive: true })
await cp(path.join(desktop, 'assets'), path.join(staging, 'assets'), { recursive: true })
await cp(path.join(desktop, 'renderer-vue'), path.join(staging, 'renderer-vue'), { recursive: true })
await cp(path.join(desktop, 'preload.cjs'), path.join(staging, 'preload.cjs'))

await mkdir(path.join(staging, 'node_modules', '@electron-manager', 'project-core'), { recursive: true })
await cp(path.join(projectCore, 'dist'), path.join(staging, 'node_modules', '@electron-manager', 'project-core', 'dist'), { recursive: true })
await writeFile(
  path.join(staging, 'node_modules', '@electron-manager', 'project-core', 'package.json'),
  `${JSON.stringify({
    name: '@electron-manager/project-core',
    version: projectCorePackage.version,
    private: true,
    type: 'module',
    exports: {
      '.': {
        types: './dist/index.d.ts',
        default: './dist/index.js',
      },
    },
  }, null, 2)}\n`,
)

await writeFile(
  path.join(staging, 'package.json'),
  `${JSON.stringify({
    name: 'electron-manager',
    version: rootPackage.version,
    private: true,
    type: 'module',
    main: 'dist/main.js',
    dependencies: {
      '@electron-manager/project-core': projectCorePackage.version,
    },
  }, null, 2)}\n`,
)
