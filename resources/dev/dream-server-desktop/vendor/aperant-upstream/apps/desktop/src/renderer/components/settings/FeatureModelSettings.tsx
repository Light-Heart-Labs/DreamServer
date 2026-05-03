import { useTranslation } from 'react-i18next';
import { useSettingsStore } from '../../stores/settings-store';
import { saveProviderAgentConfig } from '../../stores/settings-store';
import { MultiProviderModelSelect } from './MultiProviderModelSelect';
import { ThinkingLevelSelect } from './ThinkingLevelSelect';
import { Label } from '../ui/label';
import {
  DEFAULT_FEATURE_MODELS,
  DEFAULT_FEATURE_THINKING,
  FEATURE_LABELS,
} from '@shared/constants/models';
import type { BuiltinProvider } from '@shared/types/provider-account';
import type { FeatureModelConfig, ThinkingLevel } from '@shared/types/settings';

interface FeatureModelSettingsProps {
  provider: BuiltinProvider;
}

/**
 * Per-provider feature model configuration component.
 *
 * Renders a model selector and a thinking-level selector for each feature
 * (Insights, Ideation, Roadmap, GitHub Issues, GitHub PRs, Utility).
 *
 * Reads from `settings.providerAgentConfig[provider].featureModels` with
 * fallback to `settings.featureModels` then `DEFAULT_FEATURE_MODELS`.
 * Writes via `saveProviderAgentConfig`.
 */
export function FeatureModelSettings({ provider }: FeatureModelSettingsProps) {
  const { t } = useTranslation('settings');
  const settings = useSettingsStore((state) => state.settings);

  // For Ollama, default to empty strings — Anthropic model shorthands are meaningless
  const providerFeatureDefaults: FeatureModelConfig = provider === 'ollama'
    ? { insights: '', ideation: '', roadmap: '', githubIssues: '', githubPrs: '', utility: '', naming: '' }
    : DEFAULT_FEATURE_MODELS;
  const providerThinkingDefaults = provider === 'ollama'
    ? { insights: 'low' as ThinkingLevel, ideation: 'low' as ThinkingLevel, roadmap: 'low' as ThinkingLevel, githubIssues: 'low' as ThinkingLevel, githubPrs: 'low' as ThinkingLevel, utility: 'low' as ThinkingLevel, naming: 'low' as ThinkingLevel }
    : DEFAULT_FEATURE_THINKING;

  const featureModels: FeatureModelConfig =
    settings.providerAgentConfig?.[provider]?.featureModels ?? providerFeatureDefaults;

  const featureThinking =
    settings.providerAgentConfig?.[provider]?.featureThinking ?? providerThinkingDefaults;

  const handleModelChange = (feature: keyof FeatureModelConfig, value: string) => {
    saveProviderAgentConfig(provider, {
      featureModels: { ...featureModels, [feature]: value },
    });
  };

  const handleThinkingChange = (feature: keyof FeatureModelConfig, value: string) => {
    saveProviderAgentConfig(provider, {
      featureThinking: { ...featureThinking, [feature]: value as ThinkingLevel },
    });
  };

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <Label className="text-sm font-medium text-foreground">
          {t('general.featureModelSettings')}
        </Label>
      </div>

      {(Object.keys(FEATURE_LABELS) as Array<keyof FeatureModelConfig>).map((feature) => {
        const currentModel = featureModels[feature];
        const currentThinking = featureThinking[feature];

        return (
          <div key={feature} className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium text-foreground">
                {FEATURE_LABELS[feature].label}
              </Label>
              <span className="text-xs text-muted-foreground">
                {FEATURE_LABELS[feature].description}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-3 max-w-md">
              {/* Model Select */}
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">
                  {t('general.model')}
                </Label>
                <MultiProviderModelSelect
                  value={currentModel}
                  onChange={(value) => handleModelChange(feature, value)}
                  filterProvider={provider}
                />
              </div>

              {/* Thinking Level Select */}
              <ThinkingLevelSelect
                value={currentThinking}
                onChange={(value) => handleThinkingChange(feature, value)}
                modelValue={currentModel}
                provider={provider}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
