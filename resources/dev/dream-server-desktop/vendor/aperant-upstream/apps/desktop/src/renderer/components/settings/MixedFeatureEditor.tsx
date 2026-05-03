import { useTranslation } from 'react-i18next';
import { useSettingsStore, saveSettings } from '../../stores/settings-store';
import { MultiProviderModelSelect } from './MultiProviderModelSelect';
import { ThinkingLevelSelect } from './ThinkingLevelSelect';
import { ALL_AVAILABLE_MODELS, FEATURE_LABELS } from '@shared/constants/models';
import { PROVIDER_REGISTRY } from '@shared/constants/providers';
import { Label } from '../ui/label';
import type { MixedFeatureConfig, MixedPhaseEntry, ThinkingLevel } from '@shared/types/settings';
import type { BuiltinProvider } from '@shared/types/provider-account';
import type { FeatureModelConfig } from '@shared/types/settings';

type FeatureKey = keyof FeatureModelConfig;

const FEATURE_KEYS: readonly FeatureKey[] = [
  'insights',
  'ideation',
  'roadmap',
  'githubIssues',
  'githubPrs',
  'utility',
] as const;

/**
 * Default config used when customMixedFeatureConfig is not set.
 */
const DEFAULT_MIXED_FEATURE_CONFIG: MixedFeatureConfig = {
  insights: { provider: 'anthropic', modelId: 'sonnet', thinkingLevel: 'medium' },
  ideation: { provider: 'anthropic', modelId: 'opus', thinkingLevel: 'high' },
  roadmap: { provider: 'anthropic', modelId: 'opus', thinkingLevel: 'high' },
  githubIssues: { provider: 'anthropic', modelId: 'opus', thinkingLevel: 'medium' },
  githubPrs: { provider: 'anthropic', modelId: 'opus', thinkingLevel: 'medium' },
  utility: { provider: 'anthropic', modelId: 'haiku', thinkingLevel: 'low' },
  naming: { provider: 'anthropic', modelId: 'haiku', thinkingLevel: 'low' },
};

/**
 * Resolve the provider for a given model ID from ALL_AVAILABLE_MODELS.
 * Falls back to 'anthropic' if not found.
 */
function resolveProviderForModel(modelId: string): BuiltinProvider {
  const found = ALL_AVAILABLE_MODELS.find((m) => m.value === modelId);
  return found?.provider ?? 'anthropic';
}

/**
 * Get a short display name for a provider from PROVIDER_REGISTRY.
 */
function getProviderName(provider: BuiltinProvider): string {
  return PROVIDER_REGISTRY.find((p) => p.id === provider)?.name ?? provider;
}

/**
 * Provider badge shown next to each feature row.
 */
function ProviderBadge({ provider }: { provider: BuiltinProvider }) {
  return (
    <span className="inline-flex items-center rounded bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground whitespace-nowrap">
      {getProviderName(provider)}
    </span>
  );
}

/**
 * MixedFeatureEditor — shown in the Cross-Provider tab for feature model configuration.
 *
 * Renders one row per feature (insights, ideation, roadmap, githubIssues, githubPrs, utility).
 * Each row lets the user pick a model from any provider, a thinking level
 * adapted to that provider, and displays a provider badge.
 */
export function MixedFeatureEditor() {
  const { t } = useTranslation('settings');
  const settings = useSettingsStore((s) => s.settings);

  const config: MixedFeatureConfig =
    settings.customMixedFeatureConfig ?? DEFAULT_MIXED_FEATURE_CONFIG;

  const handleModelChange = async (feature: FeatureKey, modelId: string) => {
    const provider = resolveProviderForModel(modelId);
    const current: MixedPhaseEntry = config[feature];

    const updatedEntry: MixedPhaseEntry = {
      ...current,
      provider,
      modelId,
    };

    await saveSettings({
      customMixedFeatureConfig: {
        ...config,
        [feature]: updatedEntry,
      },
    });
  };

  const handleThinkingChange = async (feature: FeatureKey, thinkingLevel: ThinkingLevel) => {
    const current: MixedPhaseEntry = config[feature];

    await saveSettings({
      customMixedFeatureConfig: {
        ...config,
        [feature]: { ...current, thinkingLevel },
      },
    });
  };

  return (
    <div className="space-y-6">
      {FEATURE_KEYS.map((feature) => {
        const entry = config[feature];
        const featureLabel = FEATURE_LABELS[feature];

        return (
          <div key={feature} className="space-y-3">
            {/* Feature label + description */}
            <div>
              <Label className="text-sm font-medium text-foreground">
                {featureLabel.label}
              </Label>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {featureLabel.description}
              </p>
            </div>

            {/* 3-column grid: Model | Thinking | Provider badge */}
            <div className="grid grid-cols-[1fr_1fr_auto] gap-3 items-end">
              {/* Model selector (all providers, no filtering) */}
              <div className="space-y-1">
                <span className="text-xs text-muted-foreground">
                  {t('agentProfile.model', { defaultValue: 'Model' })}
                </span>
                <MultiProviderModelSelect
                  value={entry.modelId}
                  onChange={(modelId) => handleModelChange(feature, modelId)}
                />
              </div>

              {/* Thinking level selector, adapted to provider */}
              <ThinkingLevelSelect
                value={entry.thinkingLevel}
                onChange={(level) => handleThinkingChange(feature, level as ThinkingLevel)}
                modelValue={entry.modelId}
                provider={entry.provider}
              />

              {/* Provider badge */}
              <div className="pb-0.5">
                <ProviderBadge provider={entry.provider} />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
