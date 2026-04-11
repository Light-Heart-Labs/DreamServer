import { useState, useEffect, useRef } from 'react'

const POLL_INTERVAL = 5000

export function useClusterStatus() {
  const [cluster, setCluster] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const fetchInFlight = useRef(false)

  useEffect(() => {
    const fetchCluster = async () => {
      if (document.hidden) return
      if (fetchInFlight.current) return
      fetchInFlight.current = true
      try {
        const res = await fetch('/api/cluster/status')
        if (res.ok) {
          setCluster(await res.json())
          setError(null)
        } else {
          throw new Error(`HTTP ${res.status}`)
        }
      } catch (err) {
        setError(err.message)
      } finally {
        fetchInFlight.current = false
        setLoading(false)
      }
    }

    fetchCluster()
    const interval = setInterval(fetchCluster, POLL_INTERVAL)
    const onVisibility = () => { if (!document.hidden) fetchCluster() }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])

  return { cluster, loading, error }
}
