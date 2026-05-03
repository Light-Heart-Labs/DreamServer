import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { RotateCcw } from 'lucide-react';
import { useActiveProvider } from '../../hooks/useActiveProvider';
import { useSettingsStore } from '../../stores/settings-store';
import { PROVIDER_REGISTRY } from '@shared/constants/providers';
import { DEFAULT_MODEL_EQUIVALENCES, ALL_AVAILABLE_MODELS } from '@shared/constants/models';
import type { BuiltinProvider } from '@shared/types/provider-account';
import type { ProviderModelSpec } from '@shared/constants/models';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Button } from '../ui/button';
import { cn } from '../../lib/utils';

const USE_DEFAULT = '__use_default__';

export function ProviderModelOverrides() {
  const { t } = useTranslation('settings');
  const { connectedProviders } = useActiveProvider();
  const { settings, saveModelOverrides } = useSettingsStore();

  // Filter out anthropic — it is the source of shorthand names, not a target
  const nonAnthropicProviders = useMemo(
    () => connectedProviders.filter((p) => p !== 'anthropic'),
    [connectedProviders]
  );

  const [activeTab, setActiveTab] = useState<BuiltinProvider | null>(
    () => nonAnthropicProviders[0] ?? null
  );

  // Keep activeTab in sync when the provider list changes
  const resolvedTab: BuiltinProvider | null =
    activeTab && (nonAnthropicProviders as BuiltinProvider[]).includes(activeTab)
      ? activeTab
      : nonAnthropicProviders[0] ?? null;

  // Shorthands that have a mapping entry for the currently selected provider
  const shorthandsForProvider = useMemo(() => {
    if (!resolvedTab) return [];
    return Object.entries(DEFAULT_MODEL_EQUIVALENCES)
      .filter(([, providerMap]) => resolvedTab in providerMap)
      .map(([shorthand]) => shorthand);
  }, [resolvedTab]);

  // Models available for the currently selected provider
  const modelsForProvider = useMemo(() => {
    if (!resolvedTab) return [];
    return ALL_AVAILABLE_MODELS.filter((m) => m.provider === resolvedTab);
  }, [resolvedTab]);

  const currentOverrides = settings.modelOverrides ?? {};

  function getOverrideValue(shorthand: string): string {
    if (!resolvedTab) return USE_DEFAULT;
    const override = (currentOverrides as Record<string, Partial<Record<BuiltinProvider, ProviderModelSpec>>>)[shorthand]?.[resolvedTab];
    if (!override) return USE_DEFAULT;
    // Find matching model in our catalog by modelId
    const match = modelsForProvider.find((m) => m.value === override.modelId);
    return match ? match.value : USE_DEFAULT;
  }

  function getDefaultLabel(shorthand: string): string {
    if (!resolvedTab) return '';
    const spec = DEFAULT_MODEL_EQUIVALENCES[shorthand]?.[resolvedTab];
    if (!spec) return '';
    const match = modelsForProvider.find((m) => m.value === spec.modelId) ??
      ALL_AVAILABLE_MODELS.find((m) => m.provider === resolvedTab && m.value === spec.modelId);
    return match ? match.label : spec.modelId;
  }

  async function handleOverrideChange(shorthand: string, modelValue: string) {
    if (!resolvedTab) return;

    const updated: Record<string, Partial<Record<BuiltinProvider, ProviderModelSpec>>> = {
      ...currentOverrides,
    };

    if (modelValue === USE_DEFAULT) {
      // Remove this shorthand+provider override
      if (updated[shorthand]) {
        const { [resolvedTab]: _removed, ...rest } = updated[shorthand] as Record<BuiltinProvider, ProviderModelSpec>;
        if (Object.keys(rest).length === 0) {
          const { [shorthand]: _s, ...remainingShorthands } = updated;
          await saveModelOverrides(remainingShorthands);
          return;
        }
        updated[shorthand] = rest;
      }
    } else {
      // Find reasoning config from the default equivalences for the selected model
      const defaultSpec = DEFAULT_MODEL_EQUIVALENCES[shorthand]?.[resolvedTab];
      const selectedModel = modelsForProvider.find((m) => m.value === modelValue);
      if (!selectedModel) return;

      const reasoningConfig: ProviderModelSpec['reasoning'] = defaultSpec?.reasoning ?? { type: 'none' };

      updated[shorthand] = {
        ...updated[shorthand],
        [resolvedTab]: {
          modelId: selectedModel.value,
          reasoning: reasoningConfig,
        },
      };
    }

    await saveModelOverrides(updated);
  }

  async function handleResetAll() {
    if (!resolvedTab) return;

    const updated: Record<string, Partial<Record<BuiltinProvider, ProviderModelSpec>>> = {};

    for (const [shorthand, providerMap] of Object.entries(currentOverrides as Record<string, Partial<Record<BuiltinProvider, ProviderModelSpec>>>)) {
      const { [resolvedTab]: _removed, ...rest } = providerMap as Record<BuiltinProvider, ProviderModelSpec>;
      if (Object.keys(rest).length > 0) {
        updated[shorthand] = rest;
      }
    }

    await saveModelOverrides(updated);
  }

  const providerName = (provider: BuiltinProvider) => {
    return PROVIDER_REGISTRY.find((p) => p.id === provider)?.name ?? provider;
  };

  if (nonAnthropicProviders.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card p-6">
        <div className="space-y-1 mb-4">
          <h3 className="text-sm font-medium text-foreground">
            {t('agentProfile.providerOverrides.title')}
          </h3>
          <p className="text-sm text-muted-foreground">
            {t('agentProfile.providerOverrides.description')}
          </p>
        </div>
        <p className="text-sm text-muted-foreground italic">
          {t('agentProfile.providerOverrides.noConnectedProviders')}
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-card p-6">
      {/* Header */}
      <div className="space-y-1 mb-4">
        <h3 className="text-sm font-medium text-foreground">
          {t('agentProfile.providerOverrides.title')}
        </h3>
        <p className="text-sm text-muted-foreground">
          {t('agentProfile.providerOverrides.description')}
        </p>
      </div>

      {/* Equivalent note */}
      <p className="text-xs text-muted-foreground mb-5 italic">
        {t('agentProfile.providerOverrides.equivalentNote')}
      </p>

      {/* Provider tabs */}
      <div className="flex gap-2 mb-5 flex-wrap">
        {nonAnthropicProviders.map((provider) => (
          <button
            key={provider}
            type="button"
            onClick={() => setActiveTab(provider)}
            className={cn(
              'px-3 py-1.5 text-xs rounded-md font-medium transition-colors',
              resolvedTab === provider
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:bg-muted/80'
            )}
          >
            {providerName(provider)}
          </button>
        ))}
      </div>

      {/* Mapping table */}
      {resolvedTab && (
        <div className="space-y-2">
          {/* Table header */}
          <div className="grid grid-cols-3 gap-3 pb-2 border-b border-border">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              {t('agentProfile.providerOverrides.shorthand')}
            </span>
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              {t('agentProfile.providerOverrides.defaultMapping')}
            </span>
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              {t('agentProfile.providerOverrides.yourOverride')}
            </span>
          </div>

          {/* Table rows */}
          {shorthandsForProvider.map((shorthand) => (
            <div
              key={shorthand}
              className="grid grid-cols-3 gap-3 items-center py-1.5"
            >
              {/* Shorthand name */}
              <span className="text-sm font-mono text-foreground">
                {shorthand}
              </span>

              {/* Default model label */}
              <span className="text-sm text-muted-foreground truncate">
                {getDefaultLabel(shorthand)}
              </span>

              {/* Override dropdown */}
              <Select
                value={getOverrideValue(shorthand)}
                onValueChange={(value) => handleOverrideChange(shorthand, value)}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={USE_DEFAULT}>
                    {t('agentProfile.providerOverrides.useDefault')}
                  </SelectItem>
                  {modelsForProvider.map((model) => (
                    <SelectItem key={model.value} value={model.value}>
                      {model.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ))}
        </div>
      )}

      {/* Reset All button */}
      {resolvedTab && shorthandsForProvider.length > 0 && (
        <div className="mt-5 pt-4 border-t border-border flex justify-end">
          <Button
            variant="outline"
            size="sm"
            onClick={handleResetAll}
            className="gap-1.5 text-xs"
          >
            <RotateCcw className="h-3 w-3" />
            {t('agentProfile.providerOverrides.resetAll')}
          </Button>
        </div>
      )}
    </div>
  );
}
