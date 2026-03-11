/**
 * API utilities for Dream Server Dashboard
 * Provides fetch wrappers with timeout, retry logic, and abort support.
 */

const DEFAULT_TIMEOUT_MS = 8000
const DEFAULT_RETRIES = 2
const RETRY_DELAY_MS = 500

/**
 * Fetch with timeout and optional retries.
 * @param {string} url - Request URL
 * @param {Object} options - Fetch options (merged with defaults)
 * @param {number} options.timeout - Timeout in ms (default: 8000)
 * @param {number} options.retries - Number of retries on failure (default: 2)
 * @returns {Promise<Response>}
 */
export async function fetchWithTimeout(url, options = {}) {
  const { timeout = DEFAULT_TIMEOUT_MS, retries = DEFAULT_RETRIES, ...fetchOptions } = options

  let lastError
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeout)
    try {
      const response = await fetch(url, {
        ...fetchOptions,
        signal: controller.signal,
      })
      clearTimeout(timeoutId)
      return response
    } catch (err) {
      clearTimeout(timeoutId)
      lastError = err
      if (attempt < retries && err.name === 'AbortError') {
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS))
      } else {
        throw err
      }
    }
  }
  throw lastError
}

/**
 * Fetch JSON with timeout. Returns null on non-OK or parse error.
 * @param {string} url
 * @param {Object} options - { timeout, retries, headers }
 * @returns {Promise<Object|null>}
 */
export async function fetchJson(url, options = {}) {
  const response = await fetchWithTimeout(url, options)
  if (!response.ok) return null
  try {
    return await response.json()
  } catch {
    return null
  }
}

/**
 * Measure request latency. Returns { data, latencyMs } or throws.
 * @param {string} url
 * @param {Object} options - fetch options
 * @returns {Promise<{ data: any, latencyMs: number }>}
 */
export async function fetchWithLatency(url, options = {}) {
  const start = performance.now()
  const response = await fetchWithTimeout(url, options)
  const latencyMs = Math.round(performance.now() - start)
  const data = response.ok ? await response.json().catch(() => null) : null
  return { data, latencyMs, ok: response.ok }
}
