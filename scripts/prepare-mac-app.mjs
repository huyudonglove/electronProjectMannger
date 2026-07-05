import { cp, mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

const root = process.cwd()
const staging = path.join(root, 'build', 'mac-app')
const desktop = path.join(root, 'apps', 'desktop')
const projectCore = path.join(root, 'packages', 'project-core')

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
    version: '0.1.0',
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
    version: '0.1.0',
    private: true,
    type: 'module',
    main: 'dist/main.js',
    dependencies: {
      '@electron-manager/project-core': '0.1.0',
    },
  }, null, 2)}\n`,
)
