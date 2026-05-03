import { useTranslation } from 'react-i18next';
import type { BuiltinProvider } from '@shared/types/provider-account';
import {
  getReasoningConfigForModel,
  REASONING_TYPE_BADGES,
  THINKING_LEVELS,
} from '@shared/constants/models';
import type { ReasoningType } from '@shared/constants/models';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip';
import { cn } from '../../lib/utils';

interface ThinkingLevelSelectProps {
  value: string;
  onChange: (value: string) => void;
  modelValue: string;
  provider: BuiltinProvider;
  disabled?: boolean;
}

/**
 * Provider-aware thinking level selector.
 * Renders different controls based on the model's reasoning type:
 *   - 'none': disabled select showing "(No thinking)"
 *   - 'thinking_toggle': On/Off toggle appearance via Select (low = Off, high = On)
 *   - all others: standard Low / Medium / High dropdown
 */
export function ThinkingLevelSelect({
  value,
  onChange,
  modelValue,
  provider,
  disabled,
}: ThinkingLevelSelectProps) {
  const { t } = useTranslation('settings');

  const config = getReasoningConfigForModel(modelValue, provider);
  const reasoningType: ReasoningType = config.type;

  const badgeConfig = REASONING_TYPE_BADGES[reasoningType];

  // Render the badge with a tooltip when the reasoning type warrants one
  const renderBadge = () => {
    if (!badgeConfig) return null;
    const badgeLabel = t(badgeConfig.i18nKey as Parameters<typeof t>[0]);
    const tooltipText = t(
      `agentProfile.reasoning.badgeTooltip.${reasoningType}` as Parameters<typeof t>[0],
    );
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className={cn(
              'inline-flex cursor-help items-center rounded',
              'bg-primary/10 px-1.5 py-0.5',
              'text-[9px] font-medium text-primary',
            )}
          >
            {badgeLabel}
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs">
          <p className="text-xs">{tooltipText}</p>
        </TooltipContent>
      </Tooltip>
    );
  };

  // ── No thinking available ─────────────────────────────────────────────────
  if (reasoningType === 'none') {
    return (
      <div className="space-y-1">
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground">
            {t('agentProfile.thinkingLevel')}
          </span>
          {renderBadge()}
        </div>
        <Select value={value} onValueChange={onChange} disabled>
          <SelectTrigger className="h-9">
            <SelectValue placeholder={t('agentProfile.reasoning.noThinking')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={value || 'low'}>
              {t('agentProfile.reasoning.noThinking')}
            </SelectItem>
          </SelectContent>
        </Select>
      </div>
    );
  }

  // ── Toggle style (Google Gemini thinking on/off) ──────────────────────────
  if (reasoningType === 'thinking_toggle') {
    const isOn = value === 'high';
    return (
      <div className="space-y-1">
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground">
            {t('agentProfile.thinkingLevel')}
          </span>
          {renderBadge()}
        </div>
        <Select
          value={isOn ? 'high' : 'low'}
          onValueChange={onChange}
          disabled={disabled}
        >
          <SelectTrigger className="h-9">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="low">
              {t('agentProfile.reasoning.toggle.off')}
            </SelectItem>
            <SelectItem value="high">
              {t('agentProfile.reasoning.toggle.on')}
            </SelectItem>
          </SelectContent>
        </Select>
      </div>
    );
  }

  // ── Standard Low / Medium / High / Extra High dropdown ───────────────────
  // Only show 'xhigh' (Extra High) for reasoning_effort models (OpenAI, xAI)
  const levels = reasoningType === 'reasoning_effort'
    ? THINKING_LEVELS
    : THINKING_LEVELS.filter((l) => l.value !== 'xhigh');

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5">
        <span className="text-xs text-muted-foreground">
          {t('agentProfile.thinkingLevel')}
        </span>
        {renderBadge()}
      </div>
      <Select value={value} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger className="h-9">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {levels.map((level) => (
            <SelectItem key={level.value} value={level.value}>
              {level.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
