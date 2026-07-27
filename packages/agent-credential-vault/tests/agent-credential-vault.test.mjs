import assert from 'node:assert/strict'
import { mkdtemp, readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { EncryptedCredentialVault, credentialVaultPath } from '../dist/index.js'

test('credential vault encrypts values, resolves them, and detects stale updates', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'electron-manager-credential-vault-'))
  const cipher = new FixtureCipher()
  const vault = new EncryptedCredentialVault(credentialVaultPath(root), cipher, {
    clock: () => '2026-07-27T10:00:00.000Z',
  })
  const initial = await vault.inspect(['credential.openai.default'])
  assert.equal(initial.credentials[0].configured, false)

  const saved = await vault.setCredential('credential.openai.default', 'sk-test-secret', initial.revision)
  assert.equal(saved.credentials[0].configured, true)
  assert.equal(await vault.resolveCredential('credential.openai.default'), 'sk-test-secret')

  const raw = await readFile(credentialVaultPath(root), 'utf8')
  assert.equal(raw.includes('sk-test-secret'), false)
  assert.equal(raw.includes('fixture:'), false)
  assert.match(raw, /"cipher": "fixture\.cipher\.v1"/)
  await assert.rejects(
    vault.deleteCredential('credential.openai.default', initial.revision),
    /revision conflict/,
  )

  const removed = await vault.deleteCredential('credential.openai.default', saved.revision)
  assert.equal(removed.credentials.length, 0)
  assert.equal(await vault.resolveCredential('credential.openai.default'), null)
})

test('credential vault rejects invalid refs, unavailable ciphers, and cipher drift', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'electron-manager-credential-vault-errors-'))
  const filePath = credentialVaultPath(root)
  const cipher = new FixtureCipher()
  const vault = new EncryptedCredentialVault(filePath, cipher)
  await assert.rejects(vault.setCredential('openai.default', 'secret'), /reference is invalid/)
  await assert.rejects(vault.setCredential('credential.openai.default', 'x'.repeat(65 * 1024)), /too large/)

  cipher.available = false
  await assert.rejects(vault.setCredential('credential.openai.default', 'secret'), /encryption is unavailable/)
  cipher.available = true
  await vault.setCredential('credential.openai.default', 'secret')

  const incompatible = new EncryptedCredentialVault(filePath, new FixtureCipher('fixture.cipher.v2'))
  await assert.rejects(incompatible.resolveCredential('credential.openai.default'), /cipher mismatch/)
})

class FixtureCipher {
  constructor(id = 'fixture.cipher.v1') {
    this.id = id
  }

  available = true

  isAvailable() {
    return this.available
  }

  encrypt(value) {
    return Buffer.from(`fixture:${value}`).map((byte) => byte ^ 0x5a)
  }

  decrypt(value) {
    return Buffer.from(value).map((byte) => byte ^ 0x5a).toString('utf8').replace(/^fixture:/, '')
  }
}
