/**
 * Agent Settings Resolution Hook
 *
 * Provides centralized logic for resolving agent model and thinking settings
 * based on the selected agent profile, custom overrides, provider-specific config,
 * and cross-provider mixed config.
 *
 * Resolution order for phase settings:
 * 1. Cross-provider mode active (customMixedProfileActive) → extract from mixed config entries
 * 2. Provider-specific config exists (providerAgentConfig[provider]) → use its overrides or profile defaults
 * 3. Get provider preset via getProviderPresetOrFallback(provider, profileId) for defaults
 * 4. Apply user's custom phase overrides on top of preset defaults
 * 5. Fallback to global settings
 *
 * Feature settings follow the same provider-aware resolution order.
 */

import { useMemo } from 'react';
import {
  DEFAULT_AGENT_PROFILES,
  DEFAULT_PHASE_MODELS,
  DEFAULT_PHASE_THINKING,
  DEFAULT_FEATURE_MODELS,
  DEFAULT_FEATURE_THINKING,
  getProviderPresetOrFallback,
} from '../../shared/constants/models';
import type {
  AppSettings,
  PhaseModelConfig,
  PhaseThinkingConfig,
  FeatureModelConfig,
  FeatureThinkingConfig,
  ThinkingLevel,
} from '../../shared/types/settings';
import type { BuiltinProvider } from '../../shared/types/provider-account';

/**
 * Resolved agent settings configuration
 * Contains all the resolved model and thinking settings for agents
 */
export interface ResolvedAgentSettings {
  /** Phase model settings (spec, planning, coding, qa) */
  phaseModels: PhaseModelConfig;
  /** Phase thinking level settings */
  phaseThinking: PhaseThinkingConfig;
  /** Feature model settings (insights, ideation, roadmap, githubIssues, githubPrs, utility) */
  featureModels: FeatureModelConfig;
  /** Feature thinking level settings */
  featureThinking: FeatureThinkingConfig;
}

/**
 * Agent settings source configuration
 * Determines where an agent's model and thinking settings come from
 */
export type AgentSettingsSource =
  | { type: 'phase'; phase: 'spec' | 'planning' | 'coding' | 'qa' }
  | { type: 'feature'; feature: 'insights' | 'ideation' | 'roadmap' | 'githubIssues' | 'githubPrs' | 'utility' }
  | { type: 'fixed'; model: string; thinking: ThinkingLevel };

/**
 * Resolved model and thinking for an agent
 */
export interface AgentModelConfig {
  model: string;
  thinking: ThinkingLevel;
}

/**
 * Hook to resolve agent settings based on provider, mixed config, profile, and custom overrides
 *
 * @param settings - The application settings containing selected profile and custom overrides
 * @param provider - Optional provider to use for provider-specific resolution
 * @returns Resolved agent settings with proper provider-aware profile resolution
 *
 * @example
 * ```tsx
 * const { phaseModels, phaseThinking, featureModels, featureThinking } = useResolvedAgentSettings(settings, 'anthropic');
 * ```
 */
export function useResolvedAgentSettings(
  settings: AppSettings,
  provider?: BuiltinProvider,
): ResolvedAgentSettings {
  return useMemo(() => {
    // 1. Cross-provider mode: extract from mixed config
    if (settings.customMixedProfileActive && settings.customMixedPhaseConfig) {
      const mixed = settings.customMixedPhaseConfig;
      const phaseModels: PhaseModelConfig = {
        spec: mixed.spec.modelId,
        planning: mixed.planning.modelId,
        coding: mixed.coding.modelId,
        qa: mixed.qa.modelId,
      };
      const phaseThinking: PhaseThinkingConfig = {
        spec: mixed.spec.thinkingLevel,
        planning: mixed.planning.thinkingLevel,
        coding: mixed.coding.thinkingLevel,
        qa: mixed.qa.thinkingLevel,
      };

      // Feature models from mixed feature config or defaults
      const mixedFeature = settings.customMixedFeatureConfig;
      const featureModels: FeatureModelConfig = mixedFeature
        ? {
            insights: mixedFeature.insights.modelId,
            ideation: mixedFeature.ideation.modelId,
            roadmap: mixedFeature.roadmap.modelId,
            githubIssues: mixedFeature.githubIssues.modelId,
            githubPrs: mixedFeature.githubPrs.modelId,
            utility: mixedFeature.utility.modelId,
            naming: mixedFeature.naming?.modelId ?? 'haiku',
          }
        : settings.featureModels || DEFAULT_FEATURE_MODELS;
      const featureThinking: FeatureThinkingConfig = mixedFeature
        ? {
            insights: mixedFeature.insights.thinkingLevel,
            ideation: mixedFeature.ideation.thinkingLevel,
            roadmap: mixedFeature.roadmap.thinkingLevel,
            githubIssues: mixedFeature.githubIssues.thinkingLevel,
            githubPrs: mixedFeature.githubPrs.thinkingLevel,
            utility: mixedFeature.utility.thinkingLevel,
            naming: mixedFeature.naming?.thinkingLevel ?? 'low',
          }
        : settings.featureThinking || DEFAULT_FEATURE_THINKING;

      return { phaseModels, phaseThinking, featureModels, featureThinking };
    }

    // 2. Provider-specific config
    const providerConfig = provider ? settings.providerAgentConfig?.[provider] : undefined;
    const selectedProfileId = providerConfig?.selectedAgentProfile ?? settings.selectedAgentProfile ?? 'auto';

    // 3. Resolve defaults from provider preset
    const presetDefaults = provider
      ? getProviderPresetOrFallback(provider, selectedProfileId)
      : null;

    // Profile fallback (for when no provider-specific preset exists)
    const selectedProfile = DEFAULT_AGENT_PROFILES.find((p) => p.id === selectedProfileId) || DEFAULT_AGENT_PROFILES[0];
    const profilePhaseModels = presetDefaults?.phaseModels ?? selectedProfile.phaseModels ?? DEFAULT_PHASE_MODELS;
    const profilePhaseThinking = presetDefaults?.phaseThinking ?? selectedProfile.phaseThinking ?? DEFAULT_PHASE_THINKING;

    // 4. Custom overrides take priority
    const phaseModels = providerConfig?.customPhaseModels ?? settings.customPhaseModels ?? profilePhaseModels;
    const phaseThinking = providerConfig?.customPhaseThinking ?? settings.customPhaseThinking ?? profilePhaseThinking;

    // Feature settings
    const featureModels = providerConfig?.featureModels ?? settings.featureModels ?? DEFAULT_FEATURE_MODELS;
    const featureThinking = providerConfig?.featureThinking ?? settings.featureThinking ?? DEFAULT_FEATURE_THINKING;

    return { phaseModels, phaseThinking, featureModels, featureThinking };
  }, [
    settings.customMixedProfileActive,
    settings.customMixedPhaseConfig,
    settings.customMixedFeatureConfig,
    settings.selectedAgentProfile,
    settings.customPhaseModels,
    settings.customPhaseThinking,
    settings.featureModels,
    settings.featureThinking,
    settings.providerAgentConfig,
    provider,
  ]);
}

/**
 * Resolves model and thinking settings for a specific agent based on its settings source
 *
 * @param settingsSource - The agent's settings source (phase, feature, or fixed)
 * @param resolvedSettings - The resolved agent settings from useResolvedAgentSettings
 * @returns Model and thinking configuration for the agent
 *
 * @example
 * ```tsx
 * const resolvedSettings = useResolvedAgentSettings(settings, 'anthropic');
 * const { model, thinking } = resolveAgentSettings(agentConfig.settingsSource, resolvedSettings);
 * ```
 */
export function resolveAgentSettings(
  settingsSource: AgentSettingsSource,
  resolvedSettings: ResolvedAgentSettings
): AgentModelConfig {
  if (settingsSource.type === 'phase') {
    return {
      model: resolvedSettings.phaseModels[settingsSource.phase],
      thinking: resolvedSettings.phaseThinking[settingsSource.phase],
    };
  } else if (settingsSource.type === 'feature') {
    return {
      model: resolvedSettings.featureModels[settingsSource.feature],
      thinking: resolvedSettings.featureThinking[settingsSource.feature],
    };
  } else {
    return {
      model: settingsSource.model,
      thinking: settingsSource.thinking,
    };
  }
}
