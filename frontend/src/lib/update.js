// Update check — compares the installed version (__APP_VERSION__) against
// the latest release of this fork on GitHub and optionally downloads + installs the APK.
//
// The GitHub releases API is public and answers with CORS headers, so no token is needed.
// The APK itself is not fetch()ed: a release asset is a redirect without CORS headers, which a
// WebView refuses. Filesystem.downloadFile goes through native HTTP instead, into the cache
// directory, and the system installer gets it from there via a content:// URI.

import { MOBILE } from './mobile.js'

export const RELEASES_REPO = 'MykhailoMatsyshyn/openGym'
const RELEASES_URL = `https://api.github.com/repos/${RELEASES_REPO}/releases`
export const RELEASES_PAGE = `https://github.com/${RELEASES_REPO}/releases`

/**
 * Compares two semver strings (e.g. "1.2.11" vs "1.3.0").
 * Returns  1 if a > b, -1 if a < b, 0 if equal.
 *
 * Build metadata is dropped first. A version that says which build it came from carries it as
 * semver build metadata ("1.3.8+2026-09-18.2"), and splitting that on "." makes the patch NaN —
 * which read as 0, so a release tagged that way compared as 1.3.0 and a real update went
 * unnoticed. Semver says the metadata plays no part in precedence, so "1.3.7+anything" and
 * "1.3.7" are the same version here. Dropped on both operands, so it holds whichever side
 * carries it.
 */
function compareSemver(a, b) {
  const pa = a.replace(/^v/, '').split('+')[0].split('.').map(Number)
  const pb = b.replace(/^v/, '').split('+')[0].split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0)
    if (diff > 0) return 1
    if (diff < 0) return -1
  }
  return 0
}

/**
 * Checks the GitHub releases API for a newer version.
 * Returns { hasUpdate, latestVersion, apkUrl, hashUrl, sha256 } or throws on network failure.
 *   - hasUpdate: true if the latest release tag is newer than the running build
 *   - latestVersion: the semver string of the latest release (without "v" prefix)
 *   - apkUrl: download URL of the first .apk asset, or null
 *   - sha256: the APK's SHA-256 from the asset's `digest` (GitHub computes it on upload), or null
 *   - hashUrl: download URL of a .apk.sha256 asset, or null (the CI publishes one for people
 *     checking by hand; the app uses `sha256`, since that file is a CORS-less redirect too)
 */
// One request per app session: Settings is opened often, api.github.com does not need to hear
// about it every time. The promise is cached, a failure is not.
let cached = null
export function resetUpdateCheck() { cached = null }
export async function checkForUpdate() {
  if (!cached) cached = fetchLatest().catch(e => { cached = null; throw e })
  return cached
}
async function fetchLatest() {
  const res = await fetch(RELEASES_URL + '?per_page=1', { headers: { Accept: 'application/vnd.github+json' } })
  if (!res.ok) throw new Error(`GitHub API ${res.status}`)
  const releases = await res.json()
  const none = { hasUpdate: false, latestVersion: __APP_VERSION__, apkUrl: null, hashUrl: null, sha256: null }
  if (!releases.length) return none

  const latest = releases[0]
  const latestVersion = latest.tag_name.replace(/^v/, '')
  const hasUpdate = compareSemver(latestVersion, __APP_VERSION__) > 0
  const assets = Array.isArray(latest.assets) ? latest.assets : []
  const apk = assets.find(a => /\.apk$/i.test(a.name || ''))
  const hash = assets.find(a => /\.apk\.sha256$/i.test(a.name || ''))
  const digest = /^sha256:([0-9a-f]{64})$/i.exec(apk?.digest || '')

  return {
    hasUpdate,
    latestVersion,
    apkUrl: apk?.browser_download_url || null,
    hashUrl: hash?.browser_download_url || null,
    sha256: digest ? digest[1].toLowerCase() : null,
  }
}

/**
 * Computes the SHA-256 hash of an ArrayBuffer using the Web Crypto API.
 * Returns the hex-encoded digest string.
 */
export async function sha256(buffer) {
  const hash = await crypto.subtle.digest('SHA-256', buffer)
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Downloads the APK from `url`, verifies its SHA-256 hash against `expectedHash`
 * (if provided), and triggers the Android installer.
 * Only works on the MOBILE (Capacitor) build with Android.
 *
 * @param {string} url - Direct download URL for the APK
 * @param {string|null} expectedHash - Expected SHA-256 hex string (from .sha256 asset), or null to skip verification
 * @param {function|null} onProgress - Called with (received, total) bytes during download, or null
 */
export async function downloadAndInstall(url, expectedHash = null, onProgress = null) {
  if (!MOBILE) {
    // On web, just open the release page
    window.open(RELEASES_PAGE, '_blank', 'noopener')
    return
  }

  const { Filesystem, Directory } = await import('@capacitor/filesystem')
  const fileName = 'opengym-update.apk'

  // Native download: follows GitHub's redirect without the WebView's CORS check.
  const listener = onProgress
    ? await Filesystem.addListener('progress', p => onProgress(p.bytes, p.contentLength))
    : null
  try {
    await Filesystem.downloadFile({ url, path: fileName, directory: Directory.Cache, progress: !!onProgress })
  } finally {
    await listener?.remove()
  }

  const { data } = await Filesystem.readFile({ path: fileName, directory: Directory.Cache })
  const bin = atob(data)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)

  // Size check: an APK should be at least 100 KB
  if (bytes.length < 100_000) {
    throw new Error('Downloaded file is too small to be a valid APK (' + bytes.length + ' bytes)')
  }

  // SHA-256 integrity check
  if (expectedHash) {
    const actualHash = await sha256(bytes.buffer)
    if (actualHash !== expectedHash.toLowerCase().trim()) {
      throw new Error('SHA-256 mismatch — download may be corrupted or tampered with')
    }
  }

  // Use the local InstallPlugin to trigger the Android package installer
  const { registerPlugin } = await import('@capacitor/core')
  const Install = registerPlugin('Install')
  await Install.installApk({ fileName })
}
