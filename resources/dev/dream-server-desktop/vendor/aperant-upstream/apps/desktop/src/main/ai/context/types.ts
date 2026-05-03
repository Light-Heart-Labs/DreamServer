export interface ContextFile {
  path: string;
  role: 'modify' | 'reference';
  relevance: number;
  snippet?: string;
}

export interface SubtaskContext {
  files: ContextFile[];
  services: ServiceMatch[];
  patterns: CodePattern[];
  keywords: string[];
}

export interface ServiceMatch {
  name: string;
  type: 'api' | 'database' | 'queue' | 'cache' | 'storage';
  relatedFiles: string[];
}

export interface CodePattern {
  name: string;
  description: string;
  example: string;
  files: string[];
}

/** Internal representation of a file found during search. */
export interface FileMatch {
  path: string;
  service: string;
  reason: string;
  relevanceScore: number;
  matchingLines: Array<[number, string]>;
}

/** Complete context for a task — mirrors Python TaskContext dataclass. */
export interface TaskContext {
  taskDescription: string;
  scopedServices: string[];
  filesToModify: FileMatch[];
  filesToReference: FileMatch[];
  patternsDiscovered: Record<string, string>;
  serviceContexts: Record<string, Record<string, unknown>>;
  graphHints: Record<string, unknown>[];
}

/** Index entry for a single service inside project_index.json. */
export interface ServiceInfo {
  type?: string;
  path?: string;
  language?: string;
  framework?: string;
  entry_point?: string;
  key_directories?: Record<string, string>;
}

/** Shape of .auto-claude/project_index.json */
export interface ProjectIndex {
  services?: Record<string, ServiceInfo>;
  [key: string]: unknown;
}
