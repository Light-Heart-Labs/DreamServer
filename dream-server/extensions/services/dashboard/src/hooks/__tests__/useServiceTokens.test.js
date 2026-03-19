import { renderHook, waitFor } from '@testing-library/react'
import { normalizeTokenPayload, useServiceTokens } from '../useServiceTokens'

describe('useServiceTokens', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  test('normalizes the new agents token payload shape', () => {
    expect(normalizeTokenPayload({ tokens: { openclaw: 'abc123' } })).toEqual({ openclaw: 'abc123' })
  })

  test('loads tokens from the agents token endpoint first', async () => {
    fetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ tokens: { openclaw: 'agent-token' } })
    })

    const { result } = renderHook(() => useServiceTokens())

    await waitFor(() => {
      expect(result.current.openclaw).toBe('agent-token')
    })

    expect(fetch).toHaveBeenCalledWith('/api/agents/tokens')
  })

  test('falls back to the legacy service token endpoint', async () => {
    fetch
      .mockResolvedValueOnce({ ok: false, json: () => Promise.resolve({}) })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ openclaw: 'legacy-token' })
      })

    const { result } = renderHook(() => useServiceTokens())

    await waitFor(() => {
      expect(result.current.openclaw).toBe('legacy-token')
    })

    expect(fetch).toHaveBeenNthCalledWith(1, '/api/agents/tokens')
    expect(fetch).toHaveBeenNthCalledWith(2, '/api/service-tokens')
  })

  test('returns an empty token map when both endpoints fail', async () => {
    fetch
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce({ ok: false, json: () => Promise.resolve({}) })

    const { result } = renderHook(() => useServiceTokens())

    await waitFor(() => {
      expect(result.current).toEqual({})
    })
  })

  test('keeps legacy payload objects unchanged', () => {
    expect(normalizeTokenPayload({ openclaw: 'legacy-token' })).toEqual({ openclaw: 'legacy-token' })
  })
})
