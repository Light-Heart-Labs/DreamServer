import { describe, test, expect } from 'bun:test';
import { parseEnv, getEnvValue, setEnvValue, mergeEnv } from '../src/lib/env.ts';

describe('env.ts', () => {
  describe('parseEnv()', () => {
    test('parses simple key=value pairs', () => {
      const env = parseEnv('FOO=bar\nBAZ=qux');
      expect(env).toEqual({ FOO: 'bar', BAZ: 'qux' });
    });

    test('handles double-quoted values', () => {
      const env = parseEnv('KEY="value with spaces"');
      expect(env.KEY).toBe('value with spaces');
    });

    test('handles single-quoted values', () => {
      const env = parseEnv("KEY='value with spaces'");
      expect(env.KEY).toBe('value with spaces');
    });

    test('strips inline comments from unquoted values', () => {
      const env = parseEnv('KEY=value # this is a comment');
      expect(env.KEY).toBe('value');
    });

    test('preserves # in quoted values', () => {
      const env = parseEnv('KEY="value # not a comment"');
      expect(env.KEY).toBe('value # not a comment');
    });

    test('handles empty values', () => {
      const env = parseEnv('KEY=');
      expect(env.KEY).toBe('');
    });

    test('skips blank lines and full-line comments', () => {
      const env = parseEnv('# comment\n\nKEY=val\n\n# another');
      expect(Object.keys(env)).toEqual(['KEY']);
      expect(env.KEY).toBe('val');
    });

    test('handles equals signs in values', () => {
      const env = parseEnv('KEY=a=b=c');
      expect(env.KEY).toBe('a=b=c');
    });

    test('handles values with URLs', () => {
      const env = parseEnv('LLM_API_URL=http://llama-server:8080');
      expect(env.LLM_API_URL).toBe('http://llama-server:8080');
    });

    test('trims whitespace around keys and unquoted values', () => {
      const env = parseEnv('  KEY  =  value  ');
      expect(env.KEY).toBe('value');
    });

    test('handles real .env file content', () => {
      const content = `
# Dream Server Configuration
WEBUI_SECRET=abc123
DASHBOARD_API_KEY=def456
LLM_API_URL=http://llama-server:8080
GPU_BACKEND=nvidia
ENABLE_VOICE=true
ENABLE_WORKFLOWS=false
COMPOSE_FILE=docker-compose.base.yml:docker-compose.nvidia.yml
`;
      const env = parseEnv(content);
      expect(env.WEBUI_SECRET).toBe('abc123');
      expect(env.GPU_BACKEND).toBe('nvidia');
      expect(env.ENABLE_VOICE).toBe('true');
      expect(env.COMPOSE_FILE).toBe('docker-compose.base.yml:docker-compose.nvidia.yml');
    });
  });

  describe('getEnvValue()', () => {
    test('returns value for existing key', () => {
      expect(getEnvValue('FOO=bar\nBAZ=qux', 'BAZ')).toBe('qux');
    });

    test('returns undefined for missing key', () => {
      expect(getEnvValue('FOO=bar', 'MISSING')).toBeUndefined();
    });
  });

  describe('setEnvValue()', () => {
    test('updates existing key in-place', () => {
      const result = setEnvValue('FOO=old\nBAR=keep', 'FOO', 'new');
      expect(result).toBe('FOO=new\nBAR=keep');
    });

    test('appends new key if not found', () => {
      const result = setEnvValue('FOO=bar', 'NEW', 'val');
      expect(result).toContain('NEW=val');
    });

    test('preserves comments and structure', () => {
      const content = '# Header\nFOO=old\n# Comment\nBAR=keep';
      const result = setEnvValue(content, 'FOO', 'new');
      expect(result).toContain('# Header');
      expect(result).toContain('# Comment');
      expect(result).toContain('FOO=new');
      expect(result).toContain('BAR=keep');
    });

    test('does not modify comment lines containing the key', () => {
      const content = '# FOO=commented\nFOO=real';
      const result = setEnvValue(content, 'FOO', 'updated');
      expect(result).toContain('# FOO=commented');
      expect(result).toContain('FOO=updated');
    });
  });

  describe('mergeEnv()', () => {
    test('preserves all existing keys', () => {
      const existing = 'FOO=user_value\nBAR=user_bar';
      const generated = 'FOO=default\nBAR=default';
      const result = mergeEnv(existing, generated);
      const parsed = parseEnv(result);
      expect(parsed.FOO).toBe('user_value');
      expect(parsed.BAR).toBe('user_bar');
    });

    test('appends new keys from generated', () => {
      const existing = 'FOO=keep';
      const generated = 'FOO=default\nNEW_KEY=new_value';
      const result = mergeEnv(existing, generated);
      const parsed = parseEnv(result);
      expect(parsed.FOO).toBe('keep');
      expect(parsed.NEW_KEY).toBe('new_value');
    });

    test('returns existing unchanged when no new keys', () => {
      const existing = 'FOO=bar\nBAZ=qux';
      const generated = 'FOO=default\nBAZ=default';
      const result = mergeEnv(existing, generated);
      expect(result).toBe(existing);
    });

    test('adds section header for new keys', () => {
      const existing = 'FOO=bar';
      const generated = 'FOO=bar\nNEW=val';
      const result = mergeEnv(existing, generated);
      expect(result).toContain('Added by dream-installer');
      expect(result).toContain('NEW=val');
    });
  });
});
