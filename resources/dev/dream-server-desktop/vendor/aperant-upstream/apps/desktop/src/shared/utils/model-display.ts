/**
 * Model display utilities for multi-provider UI
 *
 * Translates model shorthands (opus, sonnet, haiku) to provider-appropriate labels
 * using the existing resolveModelEquivalent() infrastructure and ALL_AVAILABLE_MODELS catalog.
 *
 * Example: getProviderModelLabel('opus', 'openai') → "o3"
 */
import { ALL_AVAILABLE_MODELS, AVAILABLE_MODELS, resolveModelEquivalent } from '../constants/models';
import type { BuiltinProvider } from '../types/provider-account';

/**
 * Get a human-readable model label for a given shorthand and provider.
 *
 * Resolution order:
 * 1. Resolve equivalence mapping for (shorthand, provider)
 * 2. Look up the resolved modelId in ALL_AVAILABLE_MODELS by value + provider
 * 3. Fallback to any ALL_AVAILABLE_MODELS entry matching the shorthand
 * 4. Fallback to the default AVAILABLE_MODELS (Anthropic-only list) label
 * 5. Return the raw shorthand
 */
export function getProviderModelLabel(
  modelShorthand: string,
  provider: BuiltinProvider,
  userOverrides?: Record<string, Partial<Record<BuiltinProvider, unknown>>>
): string {
  // Try the equivalence map first
  const spec = resolveModelEquivalent(modelShorthand, provider, userOverrides as Parameters<typeof resolveModelEquivalent>[2]);
  if (spec) {
    // Try to find a catalog entry matching the resolved modelId for this provider
    const byModelId = ALL_AVAILABLE_MODELS.find(
      m => m.provider === provider && (m.value === spec.modelId || m.value === modelShorthand)
    );
    if (byModelId) return byModelId.label;

    // Try matching just by modelId value across all providers
    const byValue = ALL_AVAILABLE_MODELS.find(m => m.value === spec.modelId);
    if (byValue) return byValue.label;
  }

  // Direct match by shorthand for the target provider
  const direct = ALL_AVAILABLE_MODELS.find(m => m.value === modelShorthand && m.provider === provider);
  if (direct) return direct.label;

  // Fallback to default Anthropic model labels
  const defaultLabel = AVAILABLE_MODELS.find(m => m.value === modelShorthand);
  if (defaultLabel) return defaultLabel.label;

  return modelShorthand;
}
