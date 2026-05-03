/**
 * Database Validators
 * ===================
 *
 * Validators for database operations (postgres, mysql, redis, mongodb).
 *
 * See apps/desktop/src/main/ai/security/validators/database-validators.ts for the TypeScript implementation.
 */

import type { ValidationResult } from '../bash-validator';

// ---------------------------------------------------------------------------
// SQL Patterns and Utilities
// ---------------------------------------------------------------------------

/** Patterns that indicate destructive SQL operations */
const DESTRUCTIVE_SQL_PATTERNS: RegExp[] = [
  /\bDROP\s+(DATABASE|SCHEMA|TABLE|INDEX|VIEW|FUNCTION|PROCEDURE|TRIGGER)\b/i,
  /\bTRUNCATE\s+(TABLE\s+)?\w+/i,
  /\bDELETE\s+FROM\s+\w+\s*(;|$)/i, // DELETE without WHERE clause
  /\bDROP\s+ALL\b/i,
  /\bDESTROY\b/i,
];

/** Safe database name patterns (test/dev databases) */
const SAFE_DATABASE_PATTERNS: RegExp[] = [
  /^test/i,
  /_test$/i,
  /^dev/i,
  /_dev$/i,
  /^local/i,
  /_local$/i,
  /^tmp/i,
  /_tmp$/i,
  /^temp/i,
  /_temp$/i,
  /^scratch/i,
  /^sandbox/i,
  /^mock/i,
  /_mock$/i,
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function shellSplit(input: string): string[] | null {
  const tokens: string[] = [];
  let current = '';
  let i = 0;
  let inSingle = false;
  let inDouble = false;

  while (i < input.length) {
    const ch = input[i];
    if (inSingle) {
      if (ch === "'") inSingle = false;
      else current += ch;
      i++;
      continue;
    }
    if (inDouble) {
      if (ch === '\\' && i + 1 < input.length) {
        current += input[i + 1];
        i += 2;
        continue;
      }
      if (ch === '"') inDouble = false;
      else current += ch;
      i++;
      continue;
    }
    if (ch === '\\' && i + 1 < input.length) {
      current += input[i + 1];
      i += 2;
      continue;
    }
    if (ch === "'") { inSingle = true; i++; continue; }
    if (ch === '"') { inDouble = true; i++; continue; }
    if (ch === ' ' || ch === '\t' || ch === '\n') {
      if (current.length > 0) { tokens.push(current); current = ''; }
      i++;
      continue;
    }
    current += ch;
    i++;
  }

  if (inSingle || inDouble) return null;
  if (current.length > 0) tokens.push(current);
  return tokens;
}

/**
 * Check if a database name appears to be a safe test/dev database.
 *
 * Ported from: _is_safe_database_name()
 */
function isSafeDatabaseName(dbName: string): boolean {
  for (const pattern of SAFE_DATABASE_PATTERNS) {
    if (pattern.test(dbName)) return true;
  }
  return false;
}

/**
 * Check if SQL contains destructive operations.
 *
 * Ported from: _contains_destructive_sql()
 * Returns [isDestructive, matchedText]
 */
function containsDestructiveSql(sql: string): [boolean, string] {
  for (const pattern of DESTRUCTIVE_SQL_PATTERNS) {
    const match = sql.match(pattern);
    if (match) {
      return [true, match[0]];
    }
  }
  return [false, ''];
}

// ---------------------------------------------------------------------------
// PostgreSQL Validators
// ---------------------------------------------------------------------------

/**
 * Validate dropdb commands — only allow dropping test/dev databases.
 *
 * Ported from: validate_dropdb_command()
 */
export function validateDropdbCommand(commandString: string): ValidationResult {
  const tokens = shellSplit(commandString);
  if (tokens === null) {
    return [false, 'Could not parse dropdb command'];
  }

  if (tokens.length === 0) {
    return [false, 'Empty dropdb command'];
  }

  // Flags that take arguments
  const flagsWithArgs = new Set([
    '-h', '--host',
    '-p', '--port',
    '-U', '--username',
    '-w', '--no-password',
    '-W', '--password',
    '--maintenance-db',
  ]);

  let dbName: string | null = null;
  let skipNext = false;

  for (const token of tokens.slice(1)) {
    if (skipNext) {
      skipNext = false;
      continue;
    }
    if (flagsWithArgs.has(token)) {
      skipNext = true;
      continue;
    }
    if (token.startsWith('-')) continue;
    dbName = token;
  }

  if (!dbName) {
    return [false, 'dropdb requires a database name'];
  }

  if (isSafeDatabaseName(dbName)) {
    return [true, ''];
  }

  return [
    false,
    `dropdb '${dbName}' blocked for safety. Only test/dev databases can be dropped autonomously. ` +
      `Safe patterns: test*, *_test, dev*, *_dev, local*, tmp*, temp*, scratch*, sandbox*, mock*`,
  ];
}

/**
 * Validate dropuser commands — only allow dropping test/dev users.
 *
 * Ported from: validate_dropuser_command()
 */
export function validateDropuserCommand(
  commandString: string,
): ValidationResult {
  const tokens = shellSplit(commandString);
  if (tokens === null) {
    return [false, 'Could not parse dropuser command'];
  }

  if (tokens.length === 0) {
    return [false, 'Empty dropuser command'];
  }

  const flagsWithArgs = new Set([
    '-h', '--host',
    '-p', '--port',
    '-U', '--username',
    '-w', '--no-password',
    '-W', '--password',
  ]);

  let username: string | null = null;
  let skipNext = false;

  for (const token of tokens.slice(1)) {
    if (skipNext) {
      skipNext = false;
      continue;
    }
    if (flagsWithArgs.has(token)) {
      skipNext = true;
      continue;
    }
    if (token.startsWith('-')) continue;
    username = token;
  }

  if (!username) {
    return [false, 'dropuser requires a username'];
  }

  // Only allow dropping test/dev users
  const safeUserPatterns: RegExp[] = [
    /^test/i,
    /_test$/i,
    /^dev/i,
    /_dev$/i,
    /^tmp/i,
    /^temp/i,
    /^mock/i,
  ];

  for (const pattern of safeUserPatterns) {
    if (pattern.test(username)) return [true, ''];
  }

  return [
    false,
    `dropuser '${username}' blocked for safety. Only test/dev users can be dropped autonomously. ` +
      `Safe patterns: test*, *_test, dev*, *_dev, tmp*, temp*, mock*`,
  ];
}

/**
 * Validate psql commands — block destructive SQL operations.
 *
 * Allows: SELECT, INSERT, UPDATE (with WHERE), CREATE, ALTER, \d commands
 * Blocks: DROP DATABASE/TABLE, TRUNCATE, DELETE without WHERE
 *
 * Ported from: validate_psql_command()
 */
export function validatePsqlCommand(commandString: string): ValidationResult {
  const tokens = shellSplit(commandString);
  if (tokens === null) {
    return [false, 'Could not parse psql command'];
  }

  if (tokens.length === 0) {
    return [false, 'Empty psql command'];
  }

  // Look for -c flag (command to execute)
  let sqlCommand: string | null = null;
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i] === '-c' && i + 1 < tokens.length) {
      sqlCommand = tokens[i + 1];
      break;
    }
    if (tokens[i].startsWith('-c') && tokens[i].length > 2) {
      // Handle -c"SQL" format
      sqlCommand = tokens[i].slice(2);
      break;
    }
  }

  if (sqlCommand) {
    const [isDestructive, matched] = containsDestructiveSql(sqlCommand);
    if (isDestructive) {
      return [
        false,
        `psql command contains destructive SQL: '${matched}'. ` +
          `DROP/TRUNCATE/DELETE operations require manual confirmation.`,
      ];
    }
  }

  return [true, ''];
}

// ---------------------------------------------------------------------------
// MySQL Validators
// ---------------------------------------------------------------------------

/**
 * Validate mysql commands — block destructive SQL operations.
 *
 * Ported from: validate_mysql_command()
 */
export function validateMysqlCommand(commandString: string): ValidationResult {
  const tokens = shellSplit(commandString);
  if (tokens === null) {
    return [false, 'Could not parse mysql command'];
  }

  if (tokens.length === 0) {
    return [false, 'Empty mysql command'];
  }

  // Look for -e flag (execute command) or --execute
  let sqlCommand: string | null = null;
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i] === '-e' && i + 1 < tokens.length) {
      sqlCommand = tokens[i + 1];
      break;
    }
    if (tokens[i].startsWith('-e') && tokens[i].length > 2) {
      sqlCommand = tokens[i].slice(2);
      break;
    }
    if (tokens[i] === '--execute' && i + 1 < tokens.length) {
      sqlCommand = tokens[i + 1];
      break;
    }
  }

  if (sqlCommand) {
    const [isDestructive, matched] = containsDestructiveSql(sqlCommand);
    if (isDestructive) {
      return [
        false,
        `mysql command contains destructive SQL: '${matched}'. ` +
          `DROP/TRUNCATE/DELETE operations require manual confirmation.`,
      ];
    }
  }

  return [true, ''];
}

/**
 * Validate mysqladmin commands — block destructive operations.
 *
 * Ported from: validate_mysqladmin_command()
 */
export function validateMysqladminCommand(
  commandString: string,
): ValidationResult {
  const dangerousOps = new Set(['drop', 'shutdown', 'kill']);

  const tokens = shellSplit(commandString);
  if (tokens === null) {
    return [false, 'Could not parse mysqladmin command'];
  }

  if (tokens.length === 0) {
    return [false, 'Empty mysqladmin command'];
  }

  for (const token of tokens.slice(1)) {
    if (dangerousOps.has(token.toLowerCase())) {
      return [
        false,
        `mysqladmin '${token}' is blocked for safety. ` +
          `Destructive operations require manual confirmation.`,
      ];
    }
  }

  return [true, ''];
}

// ---------------------------------------------------------------------------
// Redis Validators
// ---------------------------------------------------------------------------

/**
 * Validate redis-cli commands — block destructive operations.
 *
 * Blocks: FLUSHALL, FLUSHDB, DEBUG SEGFAULT, SHUTDOWN, CONFIG SET
 *
 * Ported from: validate_redis_cli_command()
 */
export function validateRedisCliCommand(
  commandString: string,
): ValidationResult {
  const dangerousRedisCommands = new Set([
    'FLUSHALL',    // Deletes ALL data from ALL databases
    'FLUSHDB',     // Deletes all data from current database
    'DEBUG',       // Can crash the server
    'SHUTDOWN',    // Shuts down the server
    'SLAVEOF',     // Can change replication
    'REPLICAOF',   // Can change replication
    'CONFIG',      // Can modify server config
    'BGSAVE',      // Can cause disk issues
    'BGREWRITEAOF', // Can cause disk issues
    'CLUSTER',     // Can modify cluster topology
  ]);

  // Flags that take arguments
  const flagsWithArgs = new Set(['-h', '-p', '-a', '-n', '--pass', '--user', '-u']);

  const tokens = shellSplit(commandString);
  if (tokens === null) {
    return [false, 'Could not parse redis-cli command'];
  }

  if (tokens.length === 0) {
    return [false, 'Empty redis-cli command'];
  }

  let skipNext = false;
  for (const token of tokens.slice(1)) {
    if (skipNext) {
      skipNext = false;
      continue;
    }
    if (flagsWithArgs.has(token)) {
      skipNext = true;
      continue;
    }
    if (token.startsWith('-')) continue;

    // This should be the Redis command
    const redisCmd = token.toUpperCase();
    if (dangerousRedisCommands.has(redisCmd)) {
      return [
        false,
        `redis-cli command '${redisCmd}' is blocked for safety. ` +
          `Destructive Redis operations require manual confirmation.`,
      ];
    }
    break; // Only check the first non-flag token
  }

  return [true, ''];
}

// ---------------------------------------------------------------------------
// MongoDB Validators
// ---------------------------------------------------------------------------

/**
 * Validate mongosh/mongo commands — block destructive operations.
 *
 * Blocks: dropDatabase(), drop(), deleteMany({}), remove({})
 *
 * Ported from: validate_mongosh_command()
 */
export function validateMongoshCommand(
  commandString: string,
): ValidationResult {
  const dangerousMongoPatterns: RegExp[] = [
    /\.dropDatabase\s*\(/i,
    /\.drop\s*\(/i,
    /\.deleteMany\s*\(\s*\{\s*\}\s*\)/i,  // deleteMany({}) - deletes all
    /\.remove\s*\(\s*\{\s*\}\s*\)/i,       // remove({}) - deletes all (deprecated)
    /db\.dropAllUsers\s*\(/i,
    /db\.dropAllRoles\s*\(/i,
  ];

  const tokens = shellSplit(commandString);
  if (tokens === null) {
    return [false, 'Could not parse mongosh command'];
  }

  if (tokens.length === 0) {
    return [false, 'Empty mongosh command'];
  }

  // Look for --eval flag
  let evalScript: string | null = null;
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i] === '--eval' && i + 1 < tokens.length) {
      evalScript = tokens[i + 1];
      break;
    }
  }

  if (evalScript) {
    for (const pattern of dangerousMongoPatterns) {
      if (pattern.test(evalScript)) {
        return [
          false,
          `mongosh command contains destructive operation matching '${pattern.source}'. ` +
            `Database drop/delete operations require manual confirmation.`,
        ];
      }
    }
  }

  return [true, ''];
}
