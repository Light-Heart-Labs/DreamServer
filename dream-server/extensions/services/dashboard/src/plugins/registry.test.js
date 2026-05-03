import { describe, expect, test } from 'vitest'
import { getSidebarExternalLinks } from './registry'

const getExternalUrl = port => `http://127.0.0.1:${port}`

describe('getSidebarExternalLinks', () => {
  test('marks manifest links healthy by service id', () => {
    const [link] = getSidebarExternalLinks({
      getExternalUrl,
      status: {
        services: [
          { id: 'hermes', name: 'Dream Server DESKTOP', status: 'healthy', port: 3011 },
        ],
      },
      apiLinks: [
        {
          id: 'hermes',
          label: 'Dream Server DESKTOP',
          port: 3011,
          ui_path: '/',
          healthNeedles: ['hermes'],
        },
      ],
    })

    expect(link.key).toBe('hermes')
    expect(link.healthy).toBe(true)
    expect(link.url).toBe('http://127.0.0.1:3011')
  })

  test('treats degraded services as openable quick links', () => {
    const [link] = getSidebarExternalLinks({
      getExternalUrl,
      status: {
        services: [
          { id: 'hermes', name: 'Dream Server DESKTOP', status: 'degraded', port: 3011 },
        ],
      },
      apiLinks: [
        {
          id: 'hermes',
          label: 'Dream Server DESKTOP',
          port: 3011,
          ui_path: '/',
          healthNeedles: ['hermes'],
        },
      ],
    })

    expect(link.healthy).toBe(true)
  })

  test('honors explicit API health when provided', () => {
    const [link] = getSidebarExternalLinks({
      getExternalUrl,
      status: {
        services: [
          { id: 'hermes', name: 'Dream Server DESKTOP', status: 'down', port: 3011 },
        ],
      },
      apiLinks: [
        {
          id: 'hermes',
          label: 'Dream Server DESKTOP',
          port: 3011,
          ui_path: '/',
          healthNeedles: ['hermes'],
          healthy: true,
        },
      ],
    })

    expect(link.healthy).toBe(true)
  })
})
