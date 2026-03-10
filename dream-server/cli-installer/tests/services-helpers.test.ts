import { describe, test, expect } from 'bun:test';
import { getDockerBaseCmd } from '../src/phases/services.ts';

describe('services.ts helpers', () => {
  describe('getDockerBaseCmd()', () => {
    test('extracts docker from sudo docker compose', () => {
      expect(getDockerBaseCmd(['sudo', 'docker', 'compose'])).toEqual(['sudo', 'docker']);
    });

    test('extracts docker from docker compose', () => {
      expect(getDockerBaseCmd(['docker', 'compose'])).toEqual(['docker']);
    });

    test('extracts docker from docker-compose standalone', () => {
      expect(getDockerBaseCmd(['docker-compose'])).toEqual(['docker']);
    });
  });
});
