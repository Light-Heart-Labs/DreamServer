import userEvent from '@testing-library/user-event'
import { render, screen, waitFor } from '../test/test-utils'
import SetupWizard from './SetupWizard'

vi.mock('./PreFlightChecks', () => ({
  PreFlightChecks: ({ onComplete }) => (
    <button onClick={onComplete}>Complete Preflight</button>
  )
}))

describe('SetupWizard', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn((url, options) => {
      if (url === '/api/setup/wizard' && !options) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            step: 3,
            config: {
              userName: 'Taylor',
              voice: 'am_michael',
              tested: false,
              preflightPassed: true,
              preflightIssues: []
            },
            voices: [
              { id: 'af_heart', name: 'Heart', desc: 'Warm, friendly female' },
              { id: 'am_michael', name: 'Michael', desc: 'Deep male' }
            ]
          })
        })
      }

      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ success: true })
      })
    }))
    localStorage.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  test('hydrates the saved setup wizard state from the API', async () => {
    render(<SetupWizard onComplete={vi.fn()} />)

    await waitFor(() => {
      expect(screen.getByDisplayValue('Taylor')).toBeInTheDocument()
    })

    expect(screen.getByText('Step 3 of 5')).toBeInTheDocument()
    expect(fetch).toHaveBeenCalledWith('/api/setup/wizard')
  })

  test('completes setup with persisted backend state', async () => {
    fetch.mockImplementation((url, options) => {
      if (url === '/api/setup/wizard' && !options) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            step: 5,
            config: {
              userName: 'Taylor',
              voice: 'am_michael',
              tested: true,
              preflightPassed: true,
              preflightIssues: []
            },
            voices: [
              { id: 'af_heart', name: 'Heart', desc: 'Warm, friendly female' },
              { id: 'am_michael', name: 'Michael', desc: 'Deep male' }
            ]
          })
        })
      }

      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ success: true })
      })
    })

    const onComplete = vi.fn()
    const user = userEvent.setup()

    render(<SetupWizard onComplete={onComplete} />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /complete setup/i })).toBeEnabled()
    })

    await user.click(screen.getByRole('button', { name: /complete setup/i }))

    await waitFor(() => {
      expect(onComplete).toHaveBeenCalled()
    })

    expect(localStorage.getItem('dream-dashboard-visited')).toBe('true')
    expect(fetch).toHaveBeenCalledWith('/api/setup/complete', { method: 'POST' })
  })
})
