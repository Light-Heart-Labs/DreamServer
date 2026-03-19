import { screen } from '@testing-library/react'
import { render } from './test/test-utils'
import App from './App' // eslint-disable-line no-unused-vars

vi.mock('./hooks/useSystemStatus', () => ({
  useSystemStatus: vi.fn(() => ({
    status: { gpu: null, services: [], model: null, bootstrap: null, uptime: 0, version: '1.0.0' },
    loading: false,
    error: null
  }))
}))

vi.mock('./hooks/useVersion', () => ({
  useVersion: vi.fn(() => ({
    version: { current: '1.0.0', update_available: false },
    loading: false,
    error: null,
    dismissUpdate: vi.fn()
  }))
}))

vi.mock('./plugins/registry', () => ({
  getInternalRoutes: vi.fn(() => []),
  getSidebarNavItems: vi.fn(() => []),
  getSidebarExternalLinks: vi.fn(() => [])
}))

vi.mock('./components/SetupWizard', () => ({
  default: ({ onComplete }) => (
    <div data-testid="setup-wizard">
      <button onClick={onComplete}>Complete</button>
    </div>
  )
}))

describe('App', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
    ))
    globalThis.localStorage.removeItem('dream-dashboard-visited')
    globalThis.localStorage.removeItem('dream-sidebar-collapsed')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  test('renders without crashing', () => {
    render(<App />)
    expect(document.querySelector('aside')).toBeInTheDocument()
  })

  test('shows SetupWizard on first visit', () => {
    // localStorage is clear, so firstRun should become true
    render(<App />)
    expect(screen.getByTestId('setup-wizard')).toBeInTheDocument()
  })

  test('hides SetupWizard when already visited', () => {
    localStorage.setItem('dream-dashboard-visited', 'true')
    render(<App />)
    expect(screen.queryByTestId('setup-wizard')).not.toBeInTheDocument()
  })

  test('renders sidebar', () => {
    localStorage.setItem('dream-dashboard-visited', 'true')
    render(<App />)
    expect(document.querySelector('aside')).toBeInTheDocument()
    expect(document.querySelector('main')).toBeInTheDocument()
  })
})
