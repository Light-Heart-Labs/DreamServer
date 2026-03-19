import { useEffect, useState } from 'react'

export function normalizeTokenPayload(payload) {
  if (payload?.tokens && typeof payload.tokens === 'object') {
    return payload.tokens
  }

  if (payload && typeof payload === 'object') {
    return payload
  }

  return {}
}

export function useServiceTokens() {
  const [serviceTokens, setServiceTokens] = useState({})

  useEffect(() => {
    let active = true

    const loadTokens = async () => {
      const endpoints = ['/api/agents/tokens', '/api/service-tokens']

      for (const endpoint of endpoints) {
        try {
          const response = await fetch(endpoint)
          if (!response.ok) {
            continue
          }

          const payload = await response.json()
          if (active) {
            setServiceTokens(normalizeTokenPayload(payload))
          }
          return
        } catch {
          // Try the next token endpoint.
        }
      }

      if (active) {
        setServiceTokens({})
      }
    }

    loadTokens()

    return () => {
      active = false
    }
  }, [])

  return serviceTokens
}
