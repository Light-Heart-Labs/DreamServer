import { describe, expect, it } from 'vitest'
import { buildTopology } from './ServiceMap'

const statusPayload = {
  services: [
    { id: 'llama-server', name: 'llama-server (LLM Inference)', status: 'healthy', port: 11434, uptime: 120 },
    { id: 'litellm', name: 'LiteLLM (API Gateway)', status: 'healthy', port: 4000, uptime: 120 },
    { id: 'open-webui', name: 'Open WebUI (Chat)', status: 'healthy', port: 3000, uptime: 120 },
    { id: 'dashboard-api', name: 'Dashboard API (System Status)', status: 'healthy', port: 3002, uptime: 120 },
    { id: 'dashboard', name: 'Dashboard (Control Center)', status: 'healthy', port: 3001, uptime: 120 },
  ],
}

describe('buildTopology', () => {
  it('uses /api/status service ids for categories and known edges', () => {
    const topology = buildTopology(statusPayload)

    expect(topology.nodes.map(node => node.id)).toEqual([
      'llama-server',
      'litellm',
      'open-webui',
      'dashboard-api',
      'dashboard',
    ])
    expect(topology.nodes.find(node => node.id === 'llama-server')?.category).toBe('core')
    expect(topology.nodes.find(node => node.id === 'litellm')?.category).toBe('middleware')
    expect(topology.nodes.find(node => node.id === 'open-webui')?.category).toBe('user-facing')
    expect(topology.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: 'litellm', target: 'llama-server', label: 'inference' }),
      expect.objectContaining({ source: 'open-webui', target: 'litellm', label: 'LLM proxy' }),
      expect.objectContaining({ source: 'dashboard', target: 'dashboard-api', label: 'API' }),
    ]))
  })

  it('does not collapse nodes when an older /api/status payload only has names', () => {
    const legacyPayload = {
      services: statusPayload.services.map(service => ({
        name: service.name,
        status: service.status,
        port: service.port,
        uptime: service.uptime,
      })),
    }

    const topology = buildTopology(legacyPayload)

    expect(topology.nodes).toHaveLength(statusPayload.services.length)
    expect(new Set(topology.nodes.map(node => node.id)).size).toBe(statusPayload.services.length)
    expect(topology.nodes.some(node => node.id === undefined)).toBe(false)
    expect(topology.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: 'litellm', target: 'llama-server' }),
      expect.objectContaining({ source: 'open-webui', target: 'litellm' }),
    ]))
  })
})
