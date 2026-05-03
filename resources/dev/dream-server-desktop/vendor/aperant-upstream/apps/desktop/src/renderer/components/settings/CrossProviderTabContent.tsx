import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Info } from 'lucide-react';
import { useSettingsStore, saveSettings } from '../../stores/settings-store';
import { MixedPhaseEditor } from './MixedPhaseEditor';
import { MixedFeatureEditor } from './MixedFeatureEditor';

/**
 * CrossProviderTabContent — rendered when the user selects the "Cross-Provider" tab
 * in Agent Profile settings.
 *
 * Activates cross-provider mode on mount, then shows separate sections for
 * pipeline phase configuration (MixedPhaseEditor) and feature model configuration
 * (MixedFeatureEditor).
 */
export function CrossProviderTabContent() {
  const { t } = useTranslation('settings');
  const settings = useSettingsStore((s) => s.settings);

  // Activate cross-provider mode when this tab is shown
  useEffect(() => {
    if (!settings.customMixedProfileActive) {
      saveSettings({ customMixedProfileActive: true });
    }
  }, []); // Only on mount

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="space-y-2">
        <h4 className="font-medium text-sm text-foreground">
          {t('agentProfile.crossProviderTab.title')}
        </h4>
        <p className="text-sm text-muted-foreground">
          {t('agentProfile.crossProviderTab.description')}
        </p>
      </div>

      {/* Info banner */}
      <div className="flex items-start gap-2 rounded-lg bg-primary/5 border border-primary/20 p-3">
        <Info className="h-4 w-4 text-primary mt-0.5 shrink-0" />
        <p className="text-xs text-primary/80">
          {t('agentProfile.crossProviderTab.activateInfo')}
        </p>
      </div>

      {/* Pipeline Phase Configuration */}
      <div className="rounded-lg border border-border bg-card p-4">
        <h4 className="font-medium text-sm text-foreground mb-1">
          {t('agentProfile.phaseConfiguration')}
        </h4>
        <p className="text-xs text-muted-foreground mb-4">
          {t('agentProfile.phaseConfigurationDescription')}
        </p>
        <MixedPhaseEditor />
      </div>

      {/* Feature Model Configuration */}
      <div className="rounded-lg border border-border bg-card p-4">
        <h4 className="font-medium text-sm text-foreground mb-1">
          {t('agentProfile.crossProviderTab.featureModelsTitle')}
        </h4>
        <p className="text-xs text-muted-foreground mb-4">
          {t('agentProfile.crossProviderTab.featureModelsDescription')}
        </p>
        <MixedFeatureEditor />
      </div>
    </div>
  );
}
