import { useState, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useActiveProvider } from '../../hooks/useActiveProvider';
import { PROVIDER_REGISTRY } from '@shared/constants/providers';
import type { BuiltinProvider } from '@shared/types/provider-account';
import { ProviderTabBar } from './ProviderTabBar';
import { AgentProfileSettings } from './AgentProfileSettings';
import { FeatureModelSettings } from './FeatureModelSettings';
import { CrossProviderTabContent } from './CrossProviderTabContent';
import { OllamaModelManager } from './OllamaModelManager';
import { Separator } from '../ui/separator';
import { saveSettings, useSettingsStore } from '../../stores/settings-store';

/**
 * ProviderAgentTabs
 *
 * Orchestrator wrapper for the entire agent settings section.
 * Shows a provider tab bar and renders agent/feature/override settings
 * scoped to the selected provider.
 */
export function ProviderAgentTabs() {
  const { t } = useTranslation('settings');
  const { connectedProviders, provider: activeProvider } = useActiveProvider();
  const settings = useSettingsStore((s) => s.settings);

  const needsSetup = useCallback((provider: BuiltinProvider): boolean => {
    if (provider !== 'ollama') return false;
    const ollamaConfig = settings.providerAgentConfig?.ollama;
    // Check phase models
    if (!ollamaConfig?.customPhaseModels) return true;
    const models = ollamaConfig.customPhaseModels;
    if (!models.spec && !models.planning && !models.coding && !models.qa) return true;
    // Check feature models — all must be set for the provider to be fully configured
    const featureModels = ollamaConfig.featureModels;
    if (!featureModels) return true;
    if (!featureModels.insights || !featureModels.ideation || !featureModels.roadmap ||
        !featureModels.githubIssues || !featureModels.githubPrs || !featureModels.utility) return true;
    return false;
  }, [settings.providerAgentConfig]);

  // Order: anthropic first, then remaining providers alphabetically
  const orderedProviders = useMemo<BuiltinProvider[]>(() => {
    const sorted = [...connectedProviders].sort((a, b) => a.localeCompare(b));
    const anthIdx = sorted.indexOf('anthropic');
    if (anthIdx > 0) {
      sorted.splice(anthIdx, 1);
      sorted.unshift('anthropic');
    }
    return sorted;
  }, [connectedProviders]);

  const [activeTab, setActiveTab] = useState<BuiltinProvider | 'cross-provider' | null>(activeProvider);

  // Keep active tab valid when providers change; fall back to first in list.
  // When cross-provider is active, resolvedTab is null (no provider selected).
  const resolvedTab: BuiltinProvider | null =
    activeTab === 'cross-provider'
      ? null
      : activeTab && orderedProviders.includes(activeTab)
        ? activeTab
        : orderedProviders[0] ?? null;

  const isCrossProviderActive = activeTab === 'cross-provider';

  if (orderedProviders.length === 0) {
    return (
      <div className="rounded-lg bg-muted/50 p-6 text-center">
        <p className="text-sm text-muted-foreground">
          {t('agentProfile.providerTabs.noProviders')}
        </p>
      </div>
    );
  }

  const providerDisplayName =
    resolvedTab !== null
      ? (PROVIDER_REGISTRY.find((p) => p.id === resolvedTab)?.name ?? resolvedTab)
      : '';

  return (
    <div className="space-y-6">
      {/* Section heading */}
      <div>
        <h3 className="text-lg font-semibold text-foreground mb-1">{t('agentProfile.title')}</h3>
        <p className="text-sm text-muted-foreground">{t('agentProfile.sectionDescription')}</p>
      </div>
      <Separator />

      {/* Tab strip (below heading) */}
      <ProviderTabBar
        providers={orderedProviders}
        activeProvider={resolvedTab}
        onProviderChange={(provider) => {
          if (isCrossProviderActive) {
            saveSettings({ customMixedProfileActive: false });
          }
          setActiveTab(provider);
        }}
        showCrossProvider
        isCrossProviderActive={isCrossProviderActive}
        onCrossProviderClick={() => setActiveTab('cross-provider')}
        crossProviderDisabled={connectedProviders.length < 2}
        needsSetup={needsSetup}
      />

      {isCrossProviderActive ? (
        <CrossProviderTabContent />
      ) : (
        <>
          {/* Subtitle */}
          {resolvedTab !== null && (
            <p className="text-sm text-muted-foreground">
              {t('agentProfile.providerTabs.configureFor', { provider: providerDisplayName })}
            </p>
          )}

          {/* Provider-scoped agent profile settings */}
          <AgentProfileSettings provider={resolvedTab ?? undefined} />

          {/* Provider-scoped feature model settings */}
          {resolvedTab && <FeatureModelSettings provider={resolvedTab} />}

          {/* Ollama model management */}
          {resolvedTab === 'ollama' && <OllamaModelManager />}
        </>
      )}
    </div>
  );
}
