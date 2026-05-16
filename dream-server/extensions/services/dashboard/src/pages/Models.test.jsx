import { createElement } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import Models from './Models'

const useModelsMock = vi.fn()

vi.mock('../hooks/useModels', () => ({
  useModels: () => useModelsMock()
}))

vi.mock('../hooks/useDownloadProgress', () => ({
  useDownloadProgress: () => ({
    isDownloading: false,
    progress: null,
    refresh: vi.fn(),
    formatBytes: (value) => `${value} B`,
    formatEta: (value) => `${value}s`,
  })
}))

function baseState(overrides = {}) {
  return {
    models: [],
    gpu: { vramUsed: 2, vramTotal: 8, vramFree: 6 },
    currentModel: null,
    configuredModel: null,
    recommendationAlternatives: [],
    loading: false,
    error: null,
    actionLoading: null,
    downloadModel: vi.fn(),
    loadModel: vi.fn(),
    benchmarkModel: vi.fn(),
    deleteModel: vi.fn(),
    refresh: vi.fn(),
    ...overrides,
  }
}

test('renders source-labelled model performance states', () => {
  useModelsMock.mockReturnValue(baseState({
    configuredModel: 'qwen3.5-9b-q4',
    recommendationAlternatives: [
      { id: 'qwen3.5-9b-q4', name: 'Qwen 3.5 9B' },
      { id: 'deepseek-r1-7b-q4', name: 'DeepSeek R1 7B' },
    ],
    models: [
      {
        id: 'qwen3.5-9b-q4',
        name: 'Qwen 3.5 9B',
        size: '5.6 GB',
        vramRequired: 8,
        contextLength: 32768,
        specialty: 'General',
        description: 'Balanced local model.',
        quantization: 'Q4_K_M',
        status: 'available',
        fitsVram: true,
        recommended: true,
        performanceLabel: 'Benchmark after first launch',
        performance: { source: 'benchmark_required' },
      },
      {
        id: 'phi4-mini-q4',
        name: 'Phi-4 Mini',
        size: '2.4 GB',
        vramRequired: 4,
        estimatedRequired: 4.4,
        contextLength: 128000,
        specialty: 'Balanced',
        description: 'Compact model.',
        quantization: 'Q4_K_M',
        status: 'available',
        fitsVram: true,
        performanceLabel: '32.1 tok/s measured locally',
        performance: { source: 'measured_local' },
      },
    ],
  }))

  render(createElement(Models))

  expect(screen.getByText('Qwen 3.5 9B')).toBeInTheDocument()
  expect(screen.getByText('Benchmark after first launch')).toBeInTheDocument()
  expect(screen.getByText('Benchmark required')).toBeInTheDocument()
  expect(screen.getByText(/Top catalog fit: Qwen 3.5 9B/)).toBeInTheDocument()
  expect(screen.getByText('Selected install')).toBeInTheDocument()
  expect(screen.getByText('Measured locally')).toBeInTheDocument()
  expect(screen.getByText('~4.4 GB incl. KV')).toBeInTheDocument()
})

test('benchmark button is only offered for the loaded model', () => {
  const benchmarkModel = vi.fn()
  useModelsMock.mockReturnValue(baseState({
    currentModel: 'qwen3.5-9b-q4',
    benchmarkModel,
    models: [
      {
        id: 'qwen3.5-9b-q4',
        name: 'Qwen 3.5 9B',
        size: '5.6 GB',
        vramRequired: 8,
        contextLength: 32768,
        specialty: 'General',
        description: 'Balanced local model.',
        quantization: 'Q4_K_M',
        status: 'loaded',
        fitsVram: true,
        performanceLabel: '41.8 tok/s measured locally',
        performance: { source: 'measured_local' },
      },
    ],
  }))

  render(createElement(Models))
  fireEvent.click(screen.getByRole('button', { name: /benchmark/i }))

  expect(benchmarkModel).toHaveBeenCalledWith('qwen3.5-9b-q4')
})
