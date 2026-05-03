/**
 * Project Analysis Types
 * ======================
 *
 * Data structures for representing technology stacks,
 * custom scripts, and security profiles for project analysis.
 *
 * See apps/desktop/src/main/ai/project/types.ts for the TypeScript implementation.
 */

// ---------------------------------------------------------------------------
// Technology Stack
// ---------------------------------------------------------------------------

export interface TechnologyStack {
  languages: string[];
  packageManagers: string[];
  frameworks: string[];
  databases: string[];
  infrastructure: string[];
  cloudProviders: string[];
  codeQualityTools: string[];
  versionManagers: string[];
}

export function createTechnologyStack(): TechnologyStack {
  return {
    languages: [],
    packageManagers: [],
    frameworks: [],
    databases: [],
    infrastructure: [],
    cloudProviders: [],
    codeQualityTools: [],
    versionManagers: [],
  };
}

// ---------------------------------------------------------------------------
// Custom Scripts
// ---------------------------------------------------------------------------

export interface CustomScripts {
  npmScripts: string[];
  makeTargets: string[];
  poetryScripts: string[];
  cargoAliases: string[];
  shellScripts: string[];
}

export function createCustomScripts(): CustomScripts {
  return {
    npmScripts: [],
    makeTargets: [],
    poetryScripts: [],
    cargoAliases: [],
    shellScripts: [],
  };
}

// ---------------------------------------------------------------------------
// Security Profile (for project analyzer output)
// ---------------------------------------------------------------------------

export interface ProjectSecurityProfile {
  baseCommands: Set<string>;
  stackCommands: Set<string>;
  scriptCommands: Set<string>;
  customCommands: Set<string>;
  detectedStack: TechnologyStack;
  customScripts: CustomScripts;
  projectDir: string;
  createdAt: string;
  projectHash: string;
  inheritedFrom: string;
  getAllAllowedCommands(): Set<string>;
}

export function createProjectSecurityProfile(): ProjectSecurityProfile {
  return {
    baseCommands: new Set<string>(),
    stackCommands: new Set<string>(),
    scriptCommands: new Set<string>(),
    customCommands: new Set<string>(),
    detectedStack: createTechnologyStack(),
    customScripts: createCustomScripts(),
    projectDir: '',
    createdAt: '',
    projectHash: '',
    inheritedFrom: '',
    getAllAllowedCommands(): Set<string> {
      return new Set([
        ...this.baseCommands,
        ...this.stackCommands,
        ...this.scriptCommands,
        ...this.customCommands,
      ]);
    },
  };
}

// ---------------------------------------------------------------------------
// Serialized form for disk storage
// ---------------------------------------------------------------------------

export interface SerializedSecurityProfile {
  base_commands: string[];
  stack_commands: string[];
  script_commands: string[];
  custom_commands: string[];
  detected_stack: {
    languages: string[];
    package_managers: string[];
    frameworks: string[];
    databases: string[];
    infrastructure: string[];
    cloud_providers: string[];
    code_quality_tools: string[];
    version_managers: string[];
  };
  custom_scripts: {
    npm_scripts: string[];
    make_targets: string[];
    poetry_scripts: string[];
    cargo_aliases: string[];
    shell_scripts: string[];
  };
  project_dir: string;
  created_at: string;
  project_hash: string;
  inherited_from?: string;
}
