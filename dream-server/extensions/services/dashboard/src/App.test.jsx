import { screen } from '@testing-library/react'
import { render } from './test/test-utils'
import App from './App' // eslint-disable-line no-unused-vars
import { useFirstRun } from './hooks/useFirstRun'

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

// Server-side first-run gating — the hook drives whether SetupWizard mounts.
// Tests below override the mock per case.
vi.mock('./hooks/useFirstRun', () => ({
  useFirstRun: vi.fn(() => ({ firstRun: false, loading: false, error: null, refresh: vi.fn() })),
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

vi.mock('./components/SplashScreen', () => ({
  default: ({ onComplete }) => {
    // In tests, immediately complete the splash so App renders normally
    onComplete?.()
    return null
  }
}))

describe('App', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
    ))
    globalThis.localStorage.removeItem('dream-sidebar-collapsed')
    globalThis.sessionStorage.removeItem('dream-splash-shown')
    useFirstRun.mockReturnValue({ firstRun: false, loading: false, error: null, refresh: vi.fn() })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  test('renders without crashing', () => {
    render(<App />)
    expect(document.querySelector('aside')).toBeInTheDocument()
  })

  test('shows SetupWizard when server reports first_run=true', () => {
    useFirstRun.mockReturnValue({ firstRun: true, loading: false, error: null, refresh: vi.fn() })
    render(<App />)
    expect(screen.getByTestId('setup-wizard')).toBeInTheDocument()
  })

  test('hides SetupWizard when server reports first_run=false', () => {
    useFirstRun.mockReturnValue({ firstRun: false, loading: false, error: null, refresh: vi.fn() })
    render(<App />)
    expect(screen.queryByTestId('setup-wizard')).not.toBeInTheDocument()
  })

  test('renders sidebar', () => {
    render(<App />)
    expect(document.querySelector('aside')).toBeInTheDocument()
    expect(document.querySelector('main')).toBeInTheDocument()
  })
})
