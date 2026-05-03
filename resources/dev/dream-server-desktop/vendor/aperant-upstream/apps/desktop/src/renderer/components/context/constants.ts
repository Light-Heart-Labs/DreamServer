import {
  Server,
  Globe,
  Cog,
  Code,
  Package,
  GitBranch,
  FileCode,
  Lightbulb,
  FolderTree,
  AlertTriangle,
  Smartphone,
  Monitor,
  GitPullRequest,
  Bug,
  Sparkles,
  Target,
  GitMerge,
  Wrench,
  BarChart2,
  Layers,
  Link,
  CheckCircle2,
  BookOpen,
  DollarSign,
  Star,
  ClipboardList,
  RefreshCw
} from 'lucide-react';
import type { MemoryType } from '../../../shared/types';

// Service type icon mapping
export const serviceTypeIcons: Record<string, React.ElementType> = {
  backend: Server,
  frontend: Globe,
  worker: Cog,
  scraper: Code,
  library: Package,
  proxy: GitBranch,
  mobile: Smartphone,
  desktop: Monitor,
  unknown: FileCode
};

// Service type color mapping
export const serviceTypeColors: Record<string, string> = {
  backend: 'bg-blue-500/10 text-blue-400 border-blue-500/30',
  frontend: 'bg-purple-500/10 text-purple-400 border-purple-500/30',
  worker: 'bg-amber-500/10 text-amber-400 border-amber-500/30',
  scraper: 'bg-green-500/10 text-green-400 border-green-500/30',
  library: 'bg-gray-500/10 text-gray-400 border-gray-500/30',
  proxy: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/30',
  mobile: 'bg-orange-500/10 text-orange-400 border-orange-500/30',
  desktop: 'bg-indigo-500/10 text-indigo-400 border-indigo-500/30',
  unknown: 'bg-muted text-muted-foreground border-muted'
};

// Memory type icon mapping (16 types)
export const memoryTypeIcons: Record<MemoryType, React.ElementType> = {
  gotcha: AlertTriangle,
  decision: GitMerge,
  preference: Star,
  pattern: RefreshCw,
  requirement: ClipboardList,
  error_pattern: Bug,
  module_insight: Lightbulb,
  prefetch_pattern: Package,
  work_state: Wrench,
  causal_dependency: Link,
  task_calibration: BarChart2,
  e2e_observation: Monitor,
  dead_end: Target,
  work_unit_outcome: CheckCircle2,
  workflow_recipe: BookOpen,
  context_cost: DollarSign
};

// Memory type colors for badges and styling (16 types)
export const memoryTypeColors: Record<MemoryType, string> = {
  gotcha: 'bg-red-500/10 text-red-400 border-red-500/30',
  decision: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/30',
  preference: 'bg-amber-500/10 text-amber-400 border-amber-500/30',
  pattern: 'bg-purple-500/10 text-purple-400 border-purple-500/30',
  requirement: 'bg-blue-500/10 text-blue-400 border-blue-500/30',
  error_pattern: 'bg-orange-500/10 text-orange-400 border-orange-500/30',
  module_insight: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/30',
  prefetch_pattern: 'bg-indigo-500/10 text-indigo-400 border-indigo-500/30',
  work_state: 'bg-slate-500/10 text-slate-400 border-slate-500/30',
  causal_dependency: 'bg-teal-500/10 text-teal-400 border-teal-500/30',
  task_calibration: 'bg-green-500/10 text-green-400 border-green-500/30',
  e2e_observation: 'bg-sky-500/10 text-sky-400 border-sky-500/30',
  dead_end: 'bg-rose-500/10 text-rose-400 border-rose-500/30',
  work_unit_outcome: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
  workflow_recipe: 'bg-violet-500/10 text-violet-400 border-violet-500/30',
  context_cost: 'bg-pink-500/10 text-pink-400 border-pink-500/30'
};

// Memory type labels for display (16 types)
export const memoryTypeLabels: Record<MemoryType, string> = {
  gotcha: 'Gotcha',
  decision: 'Decision',
  preference: 'Preference',
  pattern: 'Pattern',
  requirement: 'Requirement',
  error_pattern: 'Error Pattern',
  module_insight: 'Module Insight',
  prefetch_pattern: 'Prefetch Pattern',
  work_state: 'Work State',
  causal_dependency: 'Causal Dependency',
  task_calibration: 'Task Calibration',
  e2e_observation: 'E2E Observation',
  dead_end: 'Dead End',
  work_unit_outcome: 'Work Unit Outcome',
  workflow_recipe: 'Workflow Recipe',
  context_cost: 'Context Cost'
};

// Filter categories for grouping memory types
export const memoryFilterCategories = [
  { key: 'all', label: 'All', types: [] as MemoryType[] },
  { key: 'patterns', label: 'Patterns', types: ['pattern', 'workflow_recipe', 'prefetch_pattern'] as MemoryType[] },
  { key: 'errors', label: 'Errors & Gotchas', types: ['error_pattern', 'dead_end', 'gotcha'] as MemoryType[] },
  { key: 'decisions', label: 'Decisions', types: ['decision', 'preference', 'requirement'] as MemoryType[] },
  { key: 'insights', label: 'Code Insights', types: ['module_insight', 'causal_dependency', 'e2e_observation'] as MemoryType[] },
  { key: 'calibration', label: 'Calibration', types: ['task_calibration', 'work_unit_outcome', 'work_state', 'context_cost'] as MemoryType[] },
] as const;

export type MemoryFilterCategory = typeof memoryFilterCategories[number]['key'];

// Legacy icons kept for backward compatibility with any code still referencing old types
export const legacyMemoryTypeIcons: Record<string, React.ElementType> = {
  session_insight: Lightbulb,
  codebase_discovery: FolderTree,
  codebase_map: FolderTree,
  task_outcome: Target,
  qa_result: Target,
  historical_context: Lightbulb,
  pr_review: GitPullRequest,
  pr_finding: Bug,
  pr_pattern: Sparkles,
  pr_gotcha: AlertTriangle
};

// Legacy colors kept for backward compatibility
export const legacyMemoryTypeColors: Record<string, string> = {
  session_insight: 'bg-amber-500/10 text-amber-400 border-amber-500/30',
  codebase_discovery: 'bg-blue-500/10 text-blue-400 border-blue-500/30',
  codebase_map: 'bg-blue-500/10 text-blue-400 border-blue-500/30',
  task_outcome: 'bg-green-500/10 text-green-400 border-green-500/30',
  qa_result: 'bg-teal-500/10 text-teal-400 border-teal-500/30',
  historical_context: 'bg-slate-500/10 text-slate-400 border-slate-500/30',
  pr_review: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/30',
  pr_finding: 'bg-orange-500/10 text-orange-400 border-orange-500/30',
  pr_pattern: 'bg-purple-500/10 text-purple-400 border-purple-500/30',
  pr_gotcha: 'bg-red-500/10 text-red-400 border-red-500/30'
};
