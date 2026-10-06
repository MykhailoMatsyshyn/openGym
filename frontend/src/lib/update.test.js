import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { checkForUpdate, sha256, resetUpdateCheck } from './update.js'

// __APP_VERSION__ is defined at build time by vite.config.js (reads package.json).
// In the test environment vitest applies the same define, so it's available here.

describe('sha256', () => {
  it('computes the correct hash for a known input', async () => {
    const input = new TextEncoder().encode('hello world')
    const hash = await sha256(input.buffer)
    // Well-known SHA-256 of "hello world"
    expect(hash).toBe('b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9')
  })

  it('computes a different hash for different input', async () => {
    const a = await sha256(new TextEncoder().encode('aaa').buffer)
    const b = await sha256(new TextEncoder().encode('bbb').buffer)
    expect(a).not.toBe(b)
  })

  it('returns a 64-character hex string', async () => {
    const hash = await sha256(new TextEncoder().encode('test').buffer)
    expect(hash).toHaveLength(64)
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('checkForUpdate', () => {
  let originalFetch

  beforeEach(() => { originalFetch = globalThis.fetch; resetUpdateCheck() })
  afterEach(() => { globalThis.fetch = originalFetch })

  function mockFetch(body, status = 200) {
    globalThis.fetch = vi.fn(() => Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(body),
    }))
  }

  const HASH = 'a'.repeat(64)
  const DL = 'https://github.com/MykhailoMatsyshyn/openGym/releases/download/v99.0.0/'
  const apkAsset = (extra = {}) => ({ name: 'openGym-99.0.0.apk', browser_download_url: DL + 'openGym-99.0.0.apk', digest: 'sha256:' + HASH, ...extra })
  const hashAsset = { name: 'openGym-99.0.0.apk.sha256', browser_download_url: DL + 'openGym-99.0.0.apk.sha256', digest: 'sha256:' + 'b'.repeat(64) }

  it('asks the GitHub releases API of this fork', async () => {
    mockFetch([])
    await checkForUpdate()
    expect(globalThis.fetch.mock.calls[0][0]).toBe('https://api.github.com/repos/MykhailoMatsyshyn/openGym/releases?per_page=1')
  })

  it('reports no update when the latest release matches the current version', async () => {
    mockFetch([{ tag_name: 'v' + __APP_VERSION__, assets: [] }])
    const result = await checkForUpdate()
    expect(result.hasUpdate).toBe(false)
    expect(result.latestVersion).toBe(__APP_VERSION__)
    expect(result.apkUrl).toBe(null)
    expect(result.hashUrl).toBe(null)
    expect(result.sha256).toBe(null)
  })

  it('reports no update when the latest release is older than current', async () => {
    mockFetch([{ tag_name: 'v0.0.1', assets: [] }])
    const result = await checkForUpdate()
    expect(result.hasUpdate).toBe(false)
    expect(result.latestVersion).toBe('0.0.1')
  })

  it('reports an update when the latest release is newer', async () => {
    mockFetch([{ tag_name: 'v99.0.0', assets: [] }])
    const result = await checkForUpdate()
    expect(result.hasUpdate).toBe(true)
    expect(result.latestVersion).toBe('99.0.0')
  })

  it('handles tag names without a v prefix', async () => {
    mockFetch([{ tag_name: '99.0.0', assets: [] }])
    expect((await checkForUpdate()).latestVersion).toBe('99.0.0')
  })

  it('finds the APK, its digest and the published checksum file', async () => {
    mockFetch([{ tag_name: 'v99.0.0', assets: [hashAsset, apkAsset()] }])
    const result = await checkForUpdate()
    expect(result.apkUrl).toBe(DL + 'openGym-99.0.0.apk')
    expect(result.sha256).toBe(HASH)                       // the APK's digest, not the .sha256 file's
    expect(result.hashUrl).toBe(DL + 'openGym-99.0.0.apk.sha256')
  })

  it('has no sha256 when the asset carries no usable digest', async () => {
    for (const digest of [undefined, null, 'md5:abc', 'sha256:short']) {
      resetUpdateCheck()
      mockFetch([{ tag_name: 'v99.0.0', assets: [apkAsset({ digest })] }])
      expect((await checkForUpdate()).sha256).toBe(null)
    }
  })

  it('returns null apkUrl when no .apk asset exists', async () => {
    mockFetch([{ tag_name: 'v99.0.0', assets: [{ name: 'notes.txt', browser_download_url: DL + 'notes.txt' }] }])
    const result = await checkForUpdate()
    expect(result.apkUrl).toBe(null)
    expect(result.sha256).toBe(null)
  })

  it('returns no update when there is no release yet', async () => {
    mockFetch([])
    const result = await checkForUpdate()
    expect(result.hasUpdate).toBe(false)
    expect(result.latestVersion).toBe(__APP_VERSION__)
  })

  it('throws when the API responds with an error status', async () => {
    mockFetch(null, 500)
    await expect(checkForUpdate()).rejects.toThrow('GitHub API 500')
  })

  it('throws on network failure', async () => {
    globalThis.fetch = vi.fn(() => Promise.reject(new Error('Network error')))
    await expect(checkForUpdate()).rejects.toThrow('Network error')
  })
})

describe('semver comparison (via checkForUpdate behavior)', () => {
  let originalFetch
  beforeEach(() => { originalFetch = globalThis.fetch; resetUpdateCheck() })
  afterEach(() => { globalThis.fetch = originalFetch })

  function mockRelease(tag) {
    globalThis.fetch = vi.fn(() => Promise.resolve({
      ok: true, status: 200,
      json: () => Promise.resolve([{ tag_name: tag, assets: [] }]),
    }))
  }

  // Versions are derived from the running __APP_VERSION__ so the suite never breaks
  // when package.json bumps. bump(2, +1) raises the patch; bump(0, +1) raises the major.
  // Read without its build metadata, the way compareSemver reads it: a build that sets
  // APP_BUILD (#244) runs this suite as "1.3.8+<build>", and then it checks the installed side.
  const [MAJ, MIN, PATCH] = __APP_VERSION__.split('+')[0].split('.').map(Number)
  const bump = (idx, by) => {
    const parts = [MAJ, MIN, PATCH]
    parts[idx] += by
    return 'v' + parts.join('.')
  }

  it('detects a patch bump as an update', async () => {
    mockRelease(bump(2, 1))
    expect((await checkForUpdate()).hasUpdate).toBe(true)
  })

  it('detects a minor bump as an update', async () => {
    mockRelease(bump(1, 1))
    expect((await checkForUpdate()).hasUpdate).toBe(true)
  })

  it('detects a major bump as an update', async () => {
    mockRelease(bump(0, 1))
    expect((await checkForUpdate()).hasUpdate).toBe(true)
  })

  // A version may say which build it came from, as semver build metadata ("1.3.8+2026-09-18.2").
  // It takes no part in precedence, and splitting it on "." used to make the patch NaN — which
  // read as 0, so a tag carrying it compared as x.y.0 and a real update went unnoticed. Dropped
  // on both operands, so the same holds whichever side carries it; here it is the tag. The
  // installed side is __APP_VERSION__, a build-time define: run the suite with APP_BUILD set
  // and every case in this block reads it with metadata too.
  const BUILD = '+2026-09-18.2'
  const [MAJOR, MINOR, PATCH_N] = __APP_VERSION__.split('+')[0].split('.').map(Number)
  const tagged = (maj, min, patch) => 'v' + [maj, min, patch].join('.') + BUILD

  it('judges a tag that carries build metadata on its numbers alone', async () => {
    mockRelease(tagged(MAJOR, MINOR, PATCH_N + 1))
    expect((await checkForUpdate()).hasUpdate).toBe(true)

    resetUpdateCheck()
    mockRelease(tagged(MAJOR, MINOR, PATCH_N))
    const same = await checkForUpdate()
    expect(same.hasUpdate).toBe(false)                                   // the running release
    expect(same.latestVersion).toBe(__APP_VERSION__.split('+')[0] + BUILD)   // echoed as it came

    resetUpdateCheck()
    mockRelease(tagged(MAJOR, Math.max(0, MINOR - 1), 0))
    expect((await checkForUpdate()).hasUpdate).toBe(false)

    resetUpdateCheck()
    mockRelease(tagged(MAJOR + 1, 0, 0))
    expect((await checkForUpdate()).hasUpdate).toBe(true)
  })

  it('does not flag an older patch as an update', async () => {
    // One patch below current (current patch is always >= our test floor)
    mockRelease('v' + [MAJ, MIN, Math.max(0, PATCH - 1)].join('.'))
    // Only meaningful when we could actually go lower; when patch is 0 this equals current,
    // which correctly reports no update either way.
    expect((await checkForUpdate()).hasUpdate).toBe(false)
  })

  it('does not flag an older minor as an update', async () => {
    // A version guaranteed lower than any 1.x+ release: same major, minor 0, patch 0,
    // minus one on the minor when possible.
    mockRelease('v' + [MAJ, Math.max(0, MIN - 1), 0].join('.'))
    expect((await checkForUpdate()).hasUpdate).toBe(false)
  })
})
