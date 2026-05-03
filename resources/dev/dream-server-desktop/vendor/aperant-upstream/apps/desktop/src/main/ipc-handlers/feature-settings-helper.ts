/**
 * Feature Settings Helper
 *
 * Reads per-provider feature settings (model + thinking level) for feature runners
 * like Insights, Ideation, and Roadmap.
 *
 * Resolution order:
 * 1. providerAgentConfig[activeProvider].featureModels[featureKey]
 * 2. Legacy global settings.featureModels[featureKey]
 * 3. DEFAULT_FEATURE_MODELS[featureKey]
 *
 * The "active provider" is determined from the first account in globalPriorityOrder
 * that matches a configured providerAccount.
 */

import { readSettingsFile } from '../settings-utils';
import {
  DEFAULT_FEATURE_MODELS,
  DEFAULT_FEATURE_THINKING,
  resolveModelEquivalent,
} from '../../shared/constants/models';
import type { FeatureModelConfig, FeatureThinkingConfig } from '../../shared/types/settings';
import type { BuiltinProvider } from '../../shared/types/provider-account';
import type { ProviderAccount } from '../../shared/types/provider-account';

type FeatureKey = keyof FeatureModelConfig;

interface FeatureSettings {
  model: string;
  thinkingLevel: string;
}

/**
 * Determine the active provider from settings.
 * Looks at globalPriorityOrder + providerAccounts to find
 * the first provider in the user's priority order.
 */
function resolveActiveProvider(settings: Record<string, unknown>): BuiltinProvider | undefined {
  const priorityOrder = settings.globalPriorityOrder as string[] | undefined;
  const accounts = settings.providerAccounts as ProviderAccount[] | undefined;

  if (!priorityOrder?.length || !accounts?.length) return undefined;

  // Walk priority order, find the first account that matches
  for (const accountId of priorityOrder) {
    const account = accounts.find(a => a.id === accountId);
    if (account?.provider) {
      return account.provider as BuiltinProvider;
    }
  }

  // Fallback: use the first account's provider
  return accounts[0]?.provider as BuiltinProvider | undefined;
}

/**
 * Get feature model and thinking level for a specific feature runner.
 *
 * Reads the active provider's per-provider config first, then falls back
 * to the legacy global featureModels/featureThinking, then to defaults.
 */
export function getActiveProviderFeatureSettings(featureKey: FeatureKey): FeatureSettings {
  const settings = readSettingsFile();
  if (!settings) {
    return {
      model: DEFAULT_FEATURE_MODELS[featureKey],
      thinkingLevel: DEFAULT_FEATURE_THINKING[featureKey],
    };
  }

  // Try per-provider config first
  const activeProvider = resolveActiveProvider(settings);
  if (activeProvider) {
    const providerConfig = (settings.providerAgentConfig as Record<string, Record<string, unknown>> | undefined)?.[activeProvider];
    if (providerConfig) {
      const perProviderModels = providerConfig.featureModels as FeatureModelConfig | undefined;
      const perProviderThinking = providerConfig.featureThinking as FeatureThinkingConfig | undefined;

      const model = perProviderModels?.[featureKey];
      const thinking = perProviderThinking?.[featureKey];

      if (model) {
        return {
          model,
          thinkingLevel: thinking ?? DEFAULT_FEATURE_THINKING[featureKey],
        };
      }
    }
  }

  // Fallback to legacy global settings
  const globalModels = settings.featureModels as FeatureModelConfig | undefined;
  const globalThinking = settings.featureThinking as FeatureThinkingConfig | undefined;

  const model = globalModels?.[featureKey] ?? DEFAULT_FEATURE_MODELS[featureKey];
  const thinkingLevel = globalThinking?.[featureKey] ?? DEFAULT_FEATURE_THINKING[featureKey];

  // If the resolved model is an Anthropic shorthand (e.g. 'haiku') but the active
  // provider is non-Anthropic, resolve to the provider's equivalent model so we
  // don't send Anthropic model IDs to OpenAI/Google/etc. endpoints.
  if (activeProvider && activeProvider !== 'anthropic') {
    const equiv = resolveModelEquivalent(model, activeProvider);
    if (equiv) {
      return { model: equiv.modelId, thinkingLevel };
    }
  }

  return { model, thinkingLevel };
}
