/**
 * Shared debug logging utilities for GitHub handlers
 */

const DEBUG = process.env.DEBUG === 'true' || process.env.NODE_ENV === 'development';
const VERBOSE = process.env.VERBOSE === 'true';

/**
 * Create a context-specific logger
 */
export function createContextLogger(context: string): {
  debug: (message: string, data?: unknown) => void;
  trace: (message: string, data?: unknown) => void;
} {
  return {
    debug: (message: string, data?: unknown): void => {
      if (DEBUG) {
        if (data !== undefined) {
          console.warn(`[${context}] ${message}`, data);
        } else {
          console.warn(`[${context}] ${message}`);
        }
      }
    },
    trace: (message: string, data?: unknown): void => {
      if (VERBOSE) {
        if (data !== undefined) {
          console.warn(`[${context}] ${message}`, data);
        } else {
          console.warn(`[${context}] ${message}`);
        }
      }
    },
  };
}

/**
 * Log message with context (legacy compatibility)
 */
export function debugLog(context: string, message: string, data?: unknown): void {
  if (DEBUG) {
    if (data !== undefined) {
      console.warn(`[${context}] ${message}`, data);
    } else {
      console.warn(`[${context}] ${message}`);
    }
  }
}

/**
 * Trace log message with context - only emitted when VERBOSE=true
 */
export function traceLog(context: string, message: string, data?: unknown): void {
  if (VERBOSE) {
    if (data !== undefined) {
      console.warn(`[${context}] ${message}`, data);
    } else {
      console.warn(`[${context}] ${message}`);
    }
  }
}
