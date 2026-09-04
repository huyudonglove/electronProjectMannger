import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'

const WORKSPACE_SCOPE = '@telance-records/'
const RUNTIME_DEPENDENCY_FIELDS = ['dependencies', 'optionalDependencies', 'peerDependencies']

const root = process.cwd()
const staging = path.join(root, 'build', 'mac-app')
const desktop = path.join(root, 'apps', 'desktop')
const packagesRoot = path.join(root, 'packages')
const rootPackage = await readManifest(path.join(root, 'package.json'))
const desktopPackage = await readManifest(path.join(desktop, 'package.json'))
const workspacePackages = await loadWorkspacePackages(packagesRoot)
const runtimePackages = collectRuntimePackages(desktopPackage, workspacePackages)
const projectCorePackage = workspacePackages.get('@telance-records/project-core')?.manifest
const verifyOnly = process.argv.includes('--verify-only')

if (rootPackage.version !== desktopPackage.version || rootPackage.version !== projectCorePackage?.version) {
  throw new Error('Application package versions must match before packaging')
}

if (verifyOnly) {
  await verifyStagedRuntime(staging, runtimePackages)
  console.log(`Verified macOS runtime with ${runtimePackages.length} workspace packages.`)
} else {
  await prepareStagedRuntime()
  await verifyStagedRuntime(staging, runtimePackages)
  console.log(`Prepared macOS runtime with ${runtimePackages.length} workspace packages.`)
}

async function prepareStagedRuntime() {
  await rm(staging, { recursive: true, force: true })
  await mkdir(path.join(staging, 'node_modules', '@telance-records'), { recursive: true })

  await cp(path.join(desktop, 'dist'), path.join(staging, 'dist'), { recursive: true })
  await cp(path.join(desktop, 'assets'), path.join(staging, 'assets'), { recursive: true })
  await cp(path.join(desktop, 'renderer-vue'), path.join(staging, 'renderer-vue'), { recursive: true })
  await cp(path.join(desktop, 'preload.cjs'), path.join(staging, 'preload.cjs'))

  for (const runtimePackage of runtimePackages) {
    const target = path.join(staging, 'node_modules', ...runtimePackage.manifest.name.split('/'))
    await mkdir(target, { recursive: true })
    await cp(path.join(runtimePackage.root, 'dist'), path.join(target, 'dist'), { recursive: true })
    await writeFile(
      path.join(target, 'package.json'),
      `${JSON.stringify(createStagedManifest(runtimePackage.manifest, workspacePackages), null, 2)}\n`,
    )
  }

  await writeFile(
    path.join(staging, 'package.json'),
    `${JSON.stringify({
      name: 'telance-records',
      version: rootPackage.version,
      private: true,
      type: 'module',
      main: 'dist/main.js',
      dependencies: Object.fromEntries(runtimePackages.map(({ manifest }) => [manifest.name, manifest.version])),
    }, null, 2)}\n`,
  )
}

async function readManifest(manifestPath) {
  return JSON.parse(await readFile(manifestPath, 'utf8'))
}

async function loadWorkspacePackages(directory) {
  const packages = new Map()
  const entries = await readdir(directory, { withFileTypes: true })

  for (const entry of entries) {
    if (!entry.isDirectory()) continue

    const packageRoot = path.join(directory, entry.name)
    const manifestPath = path.join(packageRoot, 'package.json')
    let manifest

    try {
      manifest = await readManifest(manifestPath)
    } catch (error) {
      if (error?.code === 'ENOENT') continue
      throw error
    }

    if (!manifest.name?.startsWith(WORKSPACE_SCOPE)) continue
    if (packages.has(manifest.name)) throw new Error(`Duplicate workspace package: ${manifest.name}`)

    packages.set(manifest.name, { directory: entry.name, root: packageRoot, manifest })
  }

  return packages
}

function collectRuntimePackages(entryManifest, workspacePackages) {
  const collected = new Map()
  const pending = workspaceDependencyNames(entryManifest, workspacePackages)

  while (pending.length > 0) {
    const packageName = pending.shift()
    if (collected.has(packageName)) continue

    const workspacePackage = workspacePackages.get(packageName)
    if (!workspacePackage) {
      throw new Error(`Runtime workspace dependency is missing: ${packageName}`)
    }

    collected.set(packageName, workspacePackage)
    pending.push(...workspaceDependencyNames(workspacePackage.manifest, workspacePackages))
  }

  return [...collected.values()].sort((left, right) => left.manifest.name.localeCompare(right.manifest.name))
}

function workspaceDependencyNames(manifest, workspacePackages) {
  const names = new Set()

  for (const field of RUNTIME_DEPENDENCY_FIELDS) {
    for (const dependencyName of Object.keys(manifest[field] ?? {})) {
      if (dependencyName.startsWith(WORKSPACE_SCOPE)) {
        if (!workspacePackages.has(dependencyName)) {
          throw new Error(`${manifest.name} declares unknown workspace dependency ${dependencyName}`)
        }
        names.add(dependencyName)
      }
    }
  }

  return [...names]
}

function createStagedManifest(manifest, workspacePackages) {
  const stagedManifest = {
    name: manifest.name,
    version: manifest.version,
    private: true,
    type: manifest.type,
    exports: manifest.exports,
  }

  for (const field of RUNTIME_DEPENDENCY_FIELDS) {
    if (!manifest[field]) continue
    stagedManifest[field] = Object.fromEntries(
      Object.entries(manifest[field]).map(([dependencyName, version]) => [
        dependencyName,
        workspacePackages.get(dependencyName)?.manifest.version ?? version,
      ]),
    )
  }

  return Object.fromEntries(Object.entries(stagedManifest).filter(([, value]) => value !== undefined))
}

async function verifyStagedRuntime(stagedRoot, expectedPackages) {
  const expectedVersions = new Map(
    expectedPackages.map(({ manifest }) => [manifest.name, manifest.version]),
  )
  const stagedRootManifest = await readManifest(path.join(stagedRoot, 'package.json'))
  const errors = []

  for (const [packageName, version] of expectedVersions) {
    const manifestPath = path.join(stagedRoot, 'node_modules', ...packageName.split('/'), 'package.json')
    let stagedManifest

    try {
      stagedManifest = await readManifest(manifestPath)
    } catch (error) {
      errors.push(`${packageName}: staged manifest is missing (${error.message})`)
      continue
    }

    if (stagedManifest.version !== version) {
      errors.push(`${packageName}: expected version ${version}, found ${stagedManifest.version}`)
    }
    if (stagedRootManifest.dependencies?.[packageName] !== version) {
      errors.push(`${packageName}: root runtime dependency does not pin version ${version}`)
    }

    for (const dependencyName of workspaceDependencyNamesFromManifest(stagedManifest)) {
      const dependencyVersion = expectedVersions.get(dependencyName)
      if (!dependencyVersion) {
        errors.push(`${packageName}: workspace runtime dependency ${dependencyName} was not staged`)
      } else if (declaredDependencyVersion(stagedManifest, dependencyName) !== dependencyVersion) {
        errors.push(`${packageName}: dependency ${dependencyName} is not pinned to ${dependencyVersion}`)
      }
    }

    await verifyExportTargets(stagedManifest, path.dirname(manifestPath), errors)
  }

  const runtimeFiles = [
    path.join(stagedRoot, 'dist'),
    ...expectedPackages.map(({ manifest }) => path.join(
      stagedRoot,
      'node_modules',
      ...manifest.name.split('/'),
      'dist',
    )),
  ]

  for (const runtimeDirectory of runtimeFiles) {
    for (const filePath of await findJavaScriptFiles(runtimeDirectory)) {
      const source = await readFile(filePath, 'utf8')
      for (const importedPackage of findWorkspaceImports(source)) {
        if (!expectedVersions.has(importedPackage)) {
          errors.push(`${path.relative(stagedRoot, filePath)} imports unstaged package ${importedPackage}`)
        }
      }
    }
  }

  if (errors.length > 0) {
    throw new Error(`Staged macOS runtime is incomplete:\n- ${errors.join('\n- ')}`)
  }
}

function workspaceDependencyNamesFromManifest(manifest) {
  return [...new Set(RUNTIME_DEPENDENCY_FIELDS.flatMap((field) =>
    Object.keys(manifest[field] ?? {}).filter((name) => name.startsWith(WORKSPACE_SCOPE)),
  ))]
}

function declaredDependencyVersion(manifest, dependencyName) {
  for (const field of RUNTIME_DEPENDENCY_FIELDS) {
    if (manifest[field]?.[dependencyName]) return manifest[field][dependencyName]
  }
  return undefined
}

async function verifyExportTargets(manifest, packageRoot, errors) {
  for (const target of exportTargets(manifest.exports)) {
    const targetPath = path.join(packageRoot, target)
    try {
      if (!(await stat(targetPath)).isFile()) errors.push(`${manifest.name}: export target is not a file: ${target}`)
    } catch (error) {
      errors.push(`${manifest.name}: export target is missing: ${target} (${error.message})`)
    }
  }
}

function exportTargets(exportsField) {
  if (typeof exportsField === 'string') return [exportsField]
  if (!exportsField || typeof exportsField !== 'object') return []
  return Object.values(exportsField).flatMap(exportTargets)
}

async function findJavaScriptFiles(directory) {
  const files = []
  const entries = await readdir(directory, { withFileTypes: true })

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) files.push(...await findJavaScriptFiles(entryPath))
    else if (entry.isFile() && /\.(?:cjs|mjs|js)$/.test(entry.name)) files.push(entryPath)
  }

  return files
}

function findWorkspaceImports(source) {
  const imports = new Set()
  const importPattern = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*|\brequire\s*\(\s*)['"](@telance-records\/[^/'"]+)(?:\/[^'"]*)?['"]/g
  let match

  while ((match = importPattern.exec(source)) !== null) imports.add(match[1])
  return imports
}
