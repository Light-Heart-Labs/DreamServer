/**
 * Project Analyzer Module
 * =======================
 *
 * Analyzes project structure to detect technology stacks,
 * frameworks, and generate security profiles with dynamic
 * command allowlisting.
 *
 * See apps/desktop/src/main/ai/project/ for the TypeScript implementation.
 */

export { analyzeProject, buildSecurityProfile, ProjectAnalyzer } from './analyzer';
export {
  BASE_COMMANDS,
  CLOUD_COMMANDS,
  CODE_QUALITY_COMMANDS,
  DATABASE_COMMANDS,
  FRAMEWORK_COMMANDS,
  INFRASTRUCTURE_COMMANDS,
  LANGUAGE_COMMANDS,
  PACKAGE_MANAGER_COMMANDS,
  VERSION_MANAGER_COMMANDS,
} from './command-registry';
export { FrameworkDetector } from './framework-detector';
export { StackDetector } from './stack-detector';
export type {
  CustomScripts,
  ProjectSecurityProfile,
  SerializedSecurityProfile,
  TechnologyStack,
} from './types';
export { createCustomScripts, createProjectSecurityProfile, createTechnologyStack } from './types';
