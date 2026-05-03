/**
 * Service Matching and Suggestion
 *
 * Suggests which services in the project index are relevant for a task.
 * See apps/desktop/src/main/ai/context/service-matcher.ts for the TypeScript implementation.
 */

import type { ProjectIndex } from './types.js';

/**
 * Suggest up to 3 service names most relevant to the given task description.
 *
 * Falls back to the first backend + frontend service when nothing scores.
 */
export function suggestServices(task: string, projectIndex: ProjectIndex): string[] {
  const taskLower = task.toLowerCase();
  const services = projectIndex.services ?? {};

  const scored: Array<[string, number]> = [];

  for (const [serviceName, serviceInfo] of Object.entries(services)) {
    let score = 0;
    const nameLower = serviceName.toLowerCase();

    if (taskLower.includes(nameLower)) score += 10;

    const serviceType = serviceInfo.type ?? '';
    if (
      serviceType === 'backend' &&
      ['api', 'endpoint', 'route', 'database', 'model'].some(kw => taskLower.includes(kw))
    ) {
      score += 5;
    }
    if (
      serviceType === 'frontend' &&
      ['ui', 'component', 'page', 'button', 'form'].some(kw => taskLower.includes(kw))
    ) {
      score += 5;
    }
    if (
      serviceType === 'worker' &&
      ['job', 'task', 'queue', 'background', 'async'].some(kw => taskLower.includes(kw))
    ) {
      score += 5;
    }
    if (
      serviceType === 'scraper' &&
      ['scrape', 'crawl', 'fetch', 'parse'].some(kw => taskLower.includes(kw))
    ) {
      score += 5;
    }

    const framework = (serviceInfo.framework ?? '').toLowerCase();
    if (framework && taskLower.includes(framework)) score += 3;

    if (score > 0) scored.push([serviceName, score]);
  }

  if (scored.length > 0) {
    scored.sort((a, b) => b[1] - a[1]);
    return scored.slice(0, 3).map(([name]) => name);
  }

  // Default fallback — first backend + first frontend
  const defaults: string[] = [];
  for (const [name, info] of Object.entries(services)) {
    if (info.type === 'backend' && !defaults.includes(name)) {
      defaults.push(name);
    } else if (info.type === 'frontend' && !defaults.includes(name)) {
      defaults.push(name);
    }
    if (defaults.length >= 2) break;
  }

  return defaults.length > 0 ? defaults : Object.keys(services).slice(0, 2);
}
