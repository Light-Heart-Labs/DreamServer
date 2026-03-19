import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

function AllProviders({ children }) {
  return <MemoryRouter>{children}</MemoryRouter>
}

function customRender(ui, options) {
  return render(ui, { wrapper: AllProviders, ...options })
}

export * from '@testing-library/react'
export { customRender as render }
