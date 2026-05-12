import { fireEvent, screen, waitFor } from '@testing-library/react'
import { render } from '../test/test-utils'
import Invites from './Invites' // eslint-disable-line no-unused-vars

const response = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
})

const future = new Date(Date.now() + 3_600_000).toISOString()

describe('Invites', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  test('lists and revokes active invites', async () => {
    let listCount = 0
    const fetchMock = vi.fn(async (url, options = {}) => {
      if (url === '/api/auth/magic-link/list') {
        listCount += 1
        return response({
          tokens: listCount === 1 ? [{
            token_hash_prefix: 'abc12345',
            target_username: 'alice',
            scope: 'chat',
            reusable: false,
            created_at: new Date().toISOString(),
            expires_at: future,
            redemption_count: 0,
            last_redeemed_at: null,
            revoked_at: null,
            note: 'family phone',
          }] : [],
        })
      }
      if (url === '/api/auth/magic-link/abc12345' && options.method === 'DELETE') {
        return response({ revoked: true })
      }
      throw new Error(`unexpected request: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<Invites />)

    expect(await screen.findByText('alice')).toBeInTheDocument()
    expect(screen.getByText('family phone')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /revoke invite for alice/i }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/auth/magic-link/abc12345',
        expect.objectContaining({ method: 'DELETE' }),
      )
    })
    expect(await screen.findByText('No invites yet')).toBeInTheDocument()
  })

  test('generates chat-scoped invite from the backend URL and loads QR', async () => {
    const fetchMock = vi.fn(async (url, options = {}) => {
      if (url === '/api/auth/magic-link/list') {
        return response({ tokens: [] })
      }
      if (url === '/api/auth/magic-link/generate' && options.method === 'POST') {
        return response({
          token: 'plain-secret-token',
          url: 'http://auth.dream.local/magic-link/plain-secret-token',
          expires_at: future,
          target_username: 'bob',
          scope: 'chat',
          reusable: false,
        })
      }
      if (String(url).startsWith('/api/auth/magic-link/qr?url=')) {
        return response({ data_url: 'data:image/png;base64,abc123' })
      }
      throw new Error(`unexpected request: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<Invites />)

    await screen.findByText('No invites yet')
    fireEvent.click(screen.getByRole('button', { name: 'New invite' }))
    fireEvent.change(screen.getByPlaceholderText('alice'), { target: { value: 'bob' } })
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }))

    await screen.findByRole('dialog', { name: 'Invite created' })
    const generateCall = fetchMock.mock.calls.find(([url]) => url === '/api/auth/magic-link/generate')
    expect(JSON.parse(generateCall[1].body)).toMatchObject({
      target_username: 'bob',
      scope: 'chat',
      reusable: false,
    })
    expect(screen.getByDisplayValue('http://auth.dream.local/magic-link/plain-secret-token')).toBeInTheDocument()
    expect(await screen.findByAltText('QR code for invite link')).toHaveAttribute('src', 'data:image/png;base64,abc123')
  })
})
