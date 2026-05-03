/**
 * types.test.ts — Verify type exports and nativePlugin compile correctly.
 * Runtime smoke tests for type-level constructs.
 */

import { describe, it, expect } from 'vitest';
import {
  nativePlugin,
  type Memory,
  type MemoryType,
  type MemorySource,
  type MemoryScope,
  type UniversalPhase,
  type WorkUnitRef,
  type MemoryRelation,
  type MemorySearchFilters,
  type MemoryRecordEntry,
  type MemoryCandidate,
  type AcuteCandidate,
  type SignalType,
  type SessionOutcome,
  type SessionType,
} from '../types';

describe('nativePlugin', () => {
  it('has id "native"', () => {
    expect(nativePlugin.id).toBe('native');
  });

  it('maps known phases to UniversalPhase values', () => {
    expect(nativePlugin.mapPhase('planning')).toBe('define');
    expect(nativePlugin.mapPhase('spec')).toBe('define');
    expect(nativePlugin.mapPhase('coding')).toBe('implement');
    expect(nativePlugin.mapPhase('qa_review')).toBe('validate');
    expect(nativePlugin.mapPhase('qa_fix')).toBe('refine');
    expect(nativePlugin.mapPhase('debugging')).toBe('refine');
    expect(nativePlugin.mapPhase('insights')).toBe('explore');
  });

  it('returns "explore" for unknown phases', () => {
    expect(nativePlugin.mapPhase('unknown_phase')).toBe('explore');
  });

  it('resolveWorkUnitRef returns correct label with subtask', () => {
    const ref = nativePlugin.resolveWorkUnitRef({
      specNumber: '042',
      subtaskId: '3',
    });
    expect(ref.methodology).toBe('native');
    expect(ref.hierarchy).toEqual(['042', '3']);
    expect(ref.label).toBe('Spec 042 / Subtask 3');
  });

  it('resolveWorkUnitRef returns correct label without subtask', () => {
    const ref = nativePlugin.resolveWorkUnitRef({ specNumber: '007' });
    expect(ref.hierarchy).toEqual(['007']);
    expect(ref.label).toBe('Spec 007');
  });

  it('getRelayTransitions returns expected transitions', () => {
    const transitions = nativePlugin.getRelayTransitions();
    expect(transitions).toHaveLength(3);
    expect(transitions[0]).toMatchObject({ from: 'planner', to: 'coder' });
    expect(transitions[1]).toMatchObject({ from: 'coder', to: 'qa_reviewer' });
    expect(transitions[2]).toMatchObject({ from: 'qa_reviewer', to: 'qa_fixer' });
  });
});

describe('Type shape validation (compile-time checks)', () => {
  it('MemoryType values are assignable', () => {
    const types: MemoryType[] = [
      'gotcha',
      'decision',
      'preference',
      'pattern',
      'requirement',
      'error_pattern',
      'module_insight',
      'prefetch_pattern',
      'work_state',
      'causal_dependency',
      'task_calibration',
      'e2e_observation',
      'dead_end',
      'work_unit_outcome',
      'workflow_recipe',
      'context_cost',
    ];
    expect(types).toHaveLength(16);
  });

  it('MemorySource values are assignable', () => {
    const sources: MemorySource[] = [
      'agent_explicit',
      'observer_inferred',
      'qa_auto',
      'mcp_auto',
      'commit_auto',
      'user_taught',
    ];
    expect(sources).toHaveLength(6);
  });

  it('UniversalPhase values are assignable', () => {
    const phases: UniversalPhase[] = [
      'define',
      'implement',
      'validate',
      'refine',
      'explore',
      'reflect',
    ];
    expect(phases).toHaveLength(6);
  });

  it('SessionOutcome values are assignable', () => {
    const outcomes: SessionOutcome[] = ['success', 'failure', 'abandoned', 'partial'];
    expect(outcomes).toHaveLength(4);
  });

  it('SessionType values are assignable', () => {
    const types: SessionType[] = [
      'build',
      'insights',
      'roadmap',
      'terminal',
      'changelog',
      'spec_creation',
      'pr_review',
    ];
    expect(types).toHaveLength(7);
  });

  it('Memory interface can be constructed', () => {
    const memory: Memory = {
      id: 'test-id',
      type: 'gotcha',
      content: 'Test content',
      confidence: 0.9,
      tags: ['typescript', 'electron'],
      relatedFiles: ['src/main/index.ts'],
      relatedModules: ['main'],
      createdAt: new Date().toISOString(),
      lastAccessedAt: new Date().toISOString(),
      accessCount: 0,
      scope: 'global',
      source: 'user_taught',
      sessionId: 'session-001',
      provenanceSessionIds: [],
      projectId: 'test-project',
    };
    expect(memory.type).toBe('gotcha');
    expect(memory.source).toBe('user_taught');
  });

  it('MemoryRecordEntry can be constructed', () => {
    const entry: MemoryRecordEntry = {
      type: 'error_pattern',
      content: 'This error occurs when...',
      projectId: 'my-project',
      confidence: 0.85,
      source: 'qa_auto',
    };
    expect(entry.type).toBe('error_pattern');
  });

  it('WorkUnitRef can be constructed', () => {
    const ref: WorkUnitRef = {
      methodology: 'native',
      hierarchy: ['spec_042'],
      label: 'Spec 042',
    };
    expect(ref.methodology).toBe('native');
  });
});
