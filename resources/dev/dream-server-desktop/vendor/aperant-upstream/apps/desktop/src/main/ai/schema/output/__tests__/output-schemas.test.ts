import { describe, it, expect } from 'vitest';
import {
  ComplexityAssessmentOutputSchema,
  ImplementationPlanOutputSchema,
  QASignoffOutputSchema,
} from '../index';

describe('ComplexityAssessmentOutputSchema', () => {
  it('should accept valid complexity assessment', () => {
    const valid = {
      complexity: 'simple',
      confidence: 0.95,
      reasoning: 'Small change to a single file',
      needs_research: false,
      needs_self_critique: false,
    };
    expect(ComplexityAssessmentOutputSchema.parse(valid)).toEqual(valid);
  });

  it('should reject missing required fields', () => {
    expect(() => ComplexityAssessmentOutputSchema.parse({
      complexity: 'simple',
    })).toThrow();
  });

  it('should reject invalid complexity values', () => {
    expect(() => ComplexityAssessmentOutputSchema.parse({
      complexity: 'medium', // not in enum
      confidence: 0.5,
      reasoning: 'test',
      needs_research: false,
      needs_self_critique: false,
    })).toThrow();
  });
});

describe('ImplementationPlanOutputSchema', () => {
  it('should accept valid implementation plan', () => {
    const valid = {
      feature: 'Add user auth',
      workflow_type: 'feature',
      phases: [{
        id: '1',
        name: 'Setup',
        subtasks: [{
          id: '1.1',
          title: 'Create auth module',
          description: 'Set up authentication module',
          status: 'pending',
          files_to_create: ['src/auth.ts'],
          files_to_modify: ['src/app.ts'],
        }],
      }],
    };
    const result = ImplementationPlanOutputSchema.parse(valid);
    expect(result.phases).toHaveLength(1);
    expect(result.phases[0].subtasks).toHaveLength(1);
  });

  it('should reject plan with no phases', () => {
    expect(() => ImplementationPlanOutputSchema.parse({
      feature: 'test',
      workflow_type: 'feature',
      phases: [],
    })).toThrow();
  });

  it('should reject subtask with invalid status', () => {
    expect(() => ImplementationPlanOutputSchema.parse({
      feature: 'test',
      workflow_type: 'feature',
      phases: [{
        id: '1',
        name: 'Phase 1',
        subtasks: [{
          id: '1.1',
          title: 'Task',
          description: 'Test',
          status: 'done', // not in enum
          files_to_create: [],
          files_to_modify: [],
        }],
      }],
    })).toThrow();
  });
});

describe('QASignoffOutputSchema', () => {
  it('should accept approved signoff with empty issues', () => {
    const valid = {
      status: 'approved',
      issues_found: [],
    };
    expect(QASignoffOutputSchema.parse(valid)).toEqual(valid);
  });

  it('should accept rejected signoff with issues', () => {
    const valid = {
      status: 'rejected',
      issues_found: [{
        title: 'Missing tests',
        description: 'No unit tests for auth module',
        type: 'critical',
        location: 'src/auth.ts',
        fix_required: 'Add unit tests',
      }],
    };
    expect(QASignoffOutputSchema.parse(valid)).toEqual(valid);
  });

  it('should reject invalid status', () => {
    expect(() => QASignoffOutputSchema.parse({
      status: 'passed', // not in enum
      issues_found: [],
    })).toThrow();
  });
});
