"""
Token Spy Alerts System

Budget threshold monitoring and notification dispatch:
- AlertRule model for configurable thresholds
- Multi-channel notifications (webhook, email, Slack, Discord)
- Alert history tracking
- Automatic budget check on usage logging
"""

import os
import logging
import json
import hashlib
from typing import Optional, List, Dict, Any
from dataclasses import dataclass, field, asdict
from datetime import datetime, timedelta
from enum import Enum
import httpx

log = logging.getLogger("token-spy-alerts")

# ── Configuration ────────────────────────────────────────────────────────────

WEBHOOK_TIMEOUT = int(os.environ.get("ALERT_WEBHOOK_TIMEOUT", "10"))
SMTP_HOST = os.environ.get("SMTP_HOST", "")
SMTP_PORT = int(os.environ.get("SMTP_PORT", "587"))
SMTP_USER = os.environ.get("SMTP_USER", "")
SMTP_PASS = os.environ.get("SMTP_PASS", "")
SMTP_FROM = os.environ.get("SMTP_FROM", "alerts@tokenspy.local")


# ── Enums ────────────────────────────────────────────────────────────────────

class ThresholdType(str, Enum):
    """Type of threshold being monitored."""
    BUDGET_PERCENT = "budget_percent"  # 80%, 100% of monthly budget
    COST_ABSOLUTE = "cost_absolute"    # Fixed dollar amount
    TOKEN_COUNT = "token_count"        # Absolute token count
    RATE_SPIKE = "rate_spike"          # Unusual usage rate


class NotificationChannel(str, Enum):
    """Notification delivery channels."""
    WEBHOOK = "webhook"
    SLACK = "slack"
    DISCORD = "discord"
    EMAIL = "email"


class AlertStatus(str, Enum):
    """Alert delivery status."""
    PENDING = "pending"
    SENT = "sent"
    FAILED = "failed"
    ACKNOWLEDGED = "acknowledged"


class AlertSeverity(str, Enum):
    """Alert severity levels."""
    INFO = "info"
    WARNING = "warning"
    CRITICAL = "critical"


# ── Data Models ─────────────────────────────────────────────────────────────

@dataclass
class NotificationConfig:
    """Configuration for a notification channel."""
    channel: NotificationChannel
    enabled: bool = True
    url: Optional[str] = None       # For webhook/slack/discord
    email: Optional[str] = None     # For email
    metadata: Dict[str, Any] = field(default_factory=dict)


@dataclass
class AlertRule:
    """Alert rule configuration."""
    id: Optional[int] = None
    tenant_id: str = ""
    name: str = ""
    description: Optional[str] = None
    
    # Threshold configuration
    threshold_type: ThresholdType = ThresholdType.BUDGET_PERCENT
    threshold_value: float = 80.0   # e.g., 80 for 80%
    
    # Notification channels
    notification_channels: List[NotificationConfig] = field(default_factory=list)
    
    # State
    is_active: bool = True
    cooldown_minutes: int = 60      # Min time between alerts
    last_triggered_at: Optional[datetime] = None
    trigger_count: int = 0
    
    # Metadata
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


@dataclass
class AlertEvent:
    """A triggered alert event."""
    id: Optional[int] = None
    rule_id: int = 0
    tenant_id: str = ""
    
    # Alert details
    severity: AlertSeverity = AlertSeverity.WARNING
    title: str = ""
    message: str = ""
    
    # Threshold info
    threshold_type: ThresholdType = ThresholdType.BUDGET_PERCENT
    threshold_value: float = 0.0
    current_value: float = 0.0
    
    # Delivery status
    status: AlertStatus = AlertStatus.PENDING
    delivered_channels: List[str] = field(default_factory=list)
    failed_channels: List[str] = field(default_factory=list)
    delivery_errors: Dict[str, str] = field(default_factory=dict)
    
    # Timestamps
    triggered_at: Optional[datetime] = None
    acknowledged_at: Optional[datetime] = None
    acknowledged_by: Optional[str] = None


# ── Notification Dispatchers ─────────────────────────────────────────────────

async def send_webhook(url: str, payload: Dict[str, Any]) -> tuple[bool, str]:
    """Send generic webhook notification."""
    try:
        async with httpx.AsyncClient(timeout=WEBHOOK_TIMEOUT) as client:
            response = await client.post(
                url,
                json=payload,
                headers={"Content-Type": "application/json"}
            )
            response.raise_for_status()
            return True, ""
    except httpx.TimeoutException:
        return False, "Webhook timeout"
    except httpx.HTTPStatusError as e:
        return False, f"HTTP {e.response.status_code}"
    except Exception as e:
        return False, str(e)


async def send_slack(webhook_url: str, alert: AlertEvent) -> tuple[bool, str]:
    """Send Slack notification via webhook."""
    color = {
        AlertSeverity.INFO: "#36a64f",
        AlertSeverity.WARNING: "#ffcc00",
        AlertSeverity.CRITICAL: "#ff0000"
    }.get(alert.severity, "#808080")
    
    payload = {
        "attachments": [{
            "color": color,
            "title": f"🔔 {alert.title}",
            "text": alert.message,
            "fields": [
                {
                    "title": "Threshold",
                    "value": f"{alert.threshold_value}%",
                    "short": True
                },
                {
                    "title": "Current",
                    "value": f"{alert.current_value:.1f}%",
                    "short": True
                }
            ],
            "footer": "Token Spy Alerts",
            "ts": int(alert.triggered_at.timestamp()) if alert.triggered_at else int(datetime.now().timestamp())
        }]
    }
    
    return await send_webhook(webhook_url, payload)


async def send_discord(webhook_url: str, alert: AlertEvent) -> tuple[bool, str]:
    """Send Discord notification via webhook."""
    color = {
        AlertSeverity.INFO: 0x36a64f,
        AlertSeverity.WARNING: 0xffcc00,
        AlertSeverity.CRITICAL: 0xff0000
    }.get(alert.severity, 0x808080)
    
    payload = {
        "embeds": [{
            "title": f"🔔 {alert.title}",
            "description": alert.message,
            "color": color,
            "fields": [
                {
                    "name": "Threshold",
                    "value": f"{alert.threshold_value}%",
                    "inline": True
                },
                {
                    "name": "Current Usage",
                    "value": f"{alert.current_value:.1f}%",
                    "inline": True
                }
            ],
            "footer": {
                "text": "Token Spy Alerts"
            },
            "timestamp": (alert.triggered_at or datetime.now()).isoformat()
        }]
    }
    
    return await send_webhook(webhook_url, payload)


async def send_email(to_email: str, alert: AlertEvent) -> tuple[bool, str]:
    """Send email notification via SMTP."""
    if not SMTP_HOST:
        return False, "SMTP not configured"
    
    try:
        import aiosmtplib
        from email.mime.text import MIMEText
        from email.mime.multipart import MIMEMultipart
        
        msg = MIMEMultipart("alternative")
        msg["Subject"] = f"[Token Spy] {alert.severity.value.upper()}: {alert.title}"
        msg["From"] = SMTP_FROM
        msg["To"] = to_email
        
        # Plain text version
        text_content = f"""
Token Spy Alert

{alert.title}

{alert.message}

Threshold: {alert.threshold_value}%
Current: {alert.current_value:.1f}%
Severity: {alert.severity.value.upper()}
Time: {alert.triggered_at or datetime.now()}

---
Token Spy - API Usage Monitoring
"""
        
        # HTML version
        severity_color = {
            AlertSeverity.INFO: "#36a64f",
            AlertSeverity.WARNING: "#ffcc00",
            AlertSeverity.CRITICAL: "#ff0000"
        }.get(alert.severity, "#808080")
        
        html_content = f"""
<html>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
    <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: {severity_color}; color: white; padding: 15px; border-radius: 8px 8px 0 0;">
            <h2 style="margin: 0;">🔔 {alert.title}</h2>
        </div>
        <div style="border: 1px solid #ddd; border-top: none; padding: 20px; border-radius: 0 0 8px 8px;">
            <p>{alert.message}</p>
            <table style="width: 100%; margin-top: 20px;">
                <tr>
                    <td style="padding: 10px; background: #f5f5f5;"><strong>Threshold</strong></td>
                    <td style="padding: 10px; background: #f5f5f5;">{alert.threshold_value}%</td>
                </tr>
                <tr>
                    <td style="padding: 10px;"><strong>Current Usage</strong></td>
                    <td style="padding: 10px;">{alert.current_value:.1f}%</td>
                </tr>
                <tr>
                    <td style="padding: 10px; background: #f5f5f5;"><strong>Severity</strong></td>
                    <td style="padding: 10px; background: #f5f5f5;">{alert.severity.value.upper()}</td>
                </tr>
            </table>
        </div>
        <p style="color: #888; font-size: 12px; margin-top: 20px;">
            Token Spy - API Usage Monitoring
        </p>
    </div>
</body>
</html>
"""
        
        msg.attach(MIMEText(text_content, "plain"))
        msg.attach(MIMEText(html_content, "html"))
        
        await aiosmtplib.send(
            msg,
            hostname=SMTP_HOST,
            port=SMTP_PORT,
            username=SMTP_USER,
            password=SMTP_PASS,
            start_tls=True
        )
        
        return True, ""
        
    except ImportError:
        return False, "aiosmtplib not installed"
    except Exception as e:
        return False, str(e)


# ── Alert Dispatcher ─────────────────────────────────────────────────────────

async def dispatch_alert(alert: AlertEvent, channels: List[NotificationConfig]) -> AlertEvent:
    """Dispatch alert to all configured channels."""
    for config in channels:
        if not config.enabled:
            continue
        
        success = False
        error = ""
        
        try:
            if config.channel == NotificationChannel.WEBHOOK:
                if config.url:
                    payload = {
                        "event": "budget_alert",
                        "severity": alert.severity.value,
                        "title": alert.title,
                        "message": alert.message,
                        "threshold_type": alert.threshold_type.value,
                        "threshold_value": alert.threshold_value,
                        "current_value": alert.current_value,
                        "tenant_id": alert.tenant_id,
                        "triggered_at": (alert.triggered_at or datetime.now()).isoformat()
                    }
                    success, error = await send_webhook(config.url, payload)
            
            elif config.channel == NotificationChannel.SLACK:
                if config.url:
                    success, error = await send_slack(config.url, alert)
            
            elif config.channel == NotificationChannel.DISCORD:
                if config.url:
                    success, error = await send_discord(config.url, alert)
            
            elif config.channel == NotificationChannel.EMAIL:
                if config.email:
                    success, error = await send_email(config.email, alert)
        
        except Exception as e:
            error = str(e)
        
        channel_name = config.channel.value
        if success:
            alert.delivered_channels.append(channel_name)
            log.info(f"Alert delivered via {channel_name}: {alert.title}")
        else:
            alert.failed_channels.append(channel_name)
            alert.delivery_errors[channel_name] = error
            log.warning(f"Alert delivery failed via {channel_name}: {error}")
    
    # Update status
    if alert.delivered_channels:
        alert.status = AlertStatus.SENT
    elif alert.failed_channels:
        alert.status = AlertStatus.FAILED
    
    return alert


# ── Budget Check ─────────────────────────────────────────────────────────────

async def check_budget_alerts(db_backend, tenant_id: str) -> List[AlertEvent]:
    """Check budget thresholds and trigger alerts.
    
    Called after each usage log or periodically.
    Returns list of triggered alerts.
    """
    from .db_backend import get_db_connection, RealDictCursor
    
    triggered_alerts: List[AlertEvent] = []
    
    with get_db_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            # Get tenant's current budget status from API key
            cur.execute("""
                SELECT 
                    monthly_token_limit,
                    tokens_used_this_month,
                    monthly_cost_limit,
                    cost_used_this_month
                FROM api_keys
                WHERE tenant_id = %s AND is_active = TRUE
                LIMIT 1
            """, (tenant_id,))
            budget_row = cur.fetchone()
            
            if not budget_row:
                return []
            
            # Calculate current budget percentages
            token_percent = None
            cost_percent = None
            
            if budget_row['monthly_token_limit'] and budget_row['monthly_token_limit'] > 0:
                token_percent = (budget_row['tokens_used_this_month'] / budget_row['monthly_token_limit']) * 100
            
            if budget_row['monthly_cost_limit'] and budget_row['monthly_cost_limit'] > 0:
                cost_percent = (budget_row['cost_used_this_month'] / budget_row['monthly_cost_limit']) * 100
            
            # Get active alert rules for tenant
            cur.execute("""
                SELECT * FROM alert_rules
                WHERE tenant_id = %s AND is_active = TRUE
            """, (tenant_id,))
            rules = cur.fetchall()
            
            now = datetime.now()
            
            for rule_row in rules:
                rule = AlertRule(
                    id=rule_row['id'],
                    tenant_id=rule_row['tenant_id'],
                    name=rule_row['name'],
                    description=rule_row.get('description'),
                    threshold_type=ThresholdType(rule_row['threshold_type']),
                    threshold_value=float(rule_row['threshold_value']),
                    notification_channels=json.loads(rule_row.get('notification_channels', '[]')),
                    is_active=rule_row['is_active'],
                    cooldown_minutes=rule_row.get('cooldown_minutes', 60),
                    last_triggered_at=rule_row.get('last_triggered_at')
                )
                
                # Check cooldown
                if rule.last_triggered_at:
                    cooldown_end = rule.last_triggered_at + timedelta(minutes=rule.cooldown_minutes)
                    if now < cooldown_end:
                        continue
                
                # Check threshold
                current_value = None
                threshold_exceeded = False
                
                if rule.threshold_type == ThresholdType.BUDGET_PERCENT:
                    # Use cost percent if available, else token percent
                    current_value = cost_percent if cost_percent is not None else token_percent
                    if current_value is not None and current_value >= rule.threshold_value:
                        threshold_exceeded = True
                
                elif rule.threshold_type == ThresholdType.COST_ABSOLUTE:
                    current_value = float(budget_row['cost_used_this_month'])
                    if current_value >= rule.threshold_value:
                        threshold_exceeded = True
                
                elif rule.threshold_type == ThresholdType.TOKEN_COUNT:
                    current_value = budget_row['tokens_used_this_month']
                    if current_value >= rule.threshold_value:
                        threshold_exceeded = True
                
                if threshold_exceeded and current_value is not None:
                    # Determine severity
                    if rule.threshold_value >= 100:
                        severity = AlertSeverity.CRITICAL
                    elif rule.threshold_value >= 90:
                        severity = AlertSeverity.WARNING
                    else:
                        severity = AlertSeverity.INFO
                    
                    # Create alert event
                    alert = AlertEvent(
                        rule_id=rule.id,
                        tenant_id=tenant_id,
                        severity=severity,
                        title=f"Budget Alert: {rule.name}",
                        message=f"Your usage has reached {current_value:.1f}% of your budget threshold ({rule.threshold_value}%).",
                        threshold_type=rule.threshold_type,
                        threshold_value=rule.threshold_value,
                        current_value=current_value,
                        triggered_at=now
                    )
                    
                    # Parse notification channels
                    channels = []
                    for ch_data in rule.notification_channels:
                        if isinstance(ch_data, dict):
                            channels.append(NotificationConfig(
                                channel=NotificationChannel(ch_data.get('channel', 'webhook')),
                                enabled=ch_data.get('enabled', True),
                                url=ch_data.get('url'),
                                email=ch_data.get('email'),
                                metadata=ch_data.get('metadata', {})
                            ))
                    
                    # Dispatch
                    alert = await dispatch_alert(alert, channels)
                    
                    # Store alert event
                    cur.execute("""
                        INSERT INTO alert_history (
                            rule_id, tenant_id, severity, title, message,
                            threshold_type, threshold_value, current_value,
                            status, delivered_channels, failed_channels, delivery_errors,
                            triggered_at
                        ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                        RETURNING id
                    """, (
                        alert.rule_id, alert.tenant_id, alert.severity.value,
                        alert.title, alert.message, alert.threshold_type.value,
                        alert.threshold_value, alert.current_value, alert.status.value,
                        json.dumps(alert.delivered_channels),
                        json.dumps(alert.failed_channels),
                        json.dumps(alert.delivery_errors),
                        alert.triggered_at
                    ))
                    result = cur.fetchone()
                    alert.id = result['id']
                    
                    # Update rule last_triggered_at
                    cur.execute("""
                        UPDATE alert_rules
                        SET last_triggered_at = %s, trigger_count = trigger_count + 1
                        WHERE id = %s
                    """, (now, rule.id))
                    
                    conn.commit()
                    triggered_alerts.append(alert)
                    log.info(f"Alert triggered: {alert.title} (rule {rule.id})")
    
    return triggered_alerts


# ── Database Schema for Alerts ───────────────────────────────────────────────

ALERT_TABLES_SQL = """
-- Alert Rules table
CREATE TABLE IF NOT EXISTS alert_rules (
    id SERIAL PRIMARY KEY,
    tenant_id VARCHAR(64) NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    
    -- Threshold configuration
    threshold_type VARCHAR(50) NOT NULL DEFAULT 'budget_percent',
    threshold_value NUMERIC(12, 4) NOT NULL DEFAULT 80.0,
    
    -- Notification channels (JSON array)
    notification_channels JSONB DEFAULT '[]'::jsonb,
    
    -- State
    is_active BOOLEAN DEFAULT TRUE,
    cooldown_minutes INTEGER DEFAULT 60,
    last_triggered_at TIMESTAMPTZ,
    trigger_count INTEGER DEFAULT 0,
    
    -- Metadata
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Indexes
    CONSTRAINT alert_rules_tenant_name_unique UNIQUE (tenant_id, name)
);

CREATE INDEX IF NOT EXISTS idx_alert_rules_tenant ON alert_rules(tenant_id);
CREATE INDEX IF NOT EXISTS idx_alert_rules_active ON alert_rules(is_active) WHERE is_active = TRUE;

-- Alert History table
CREATE TABLE IF NOT EXISTS alert_history (
    id SERIAL PRIMARY KEY,
    rule_id INTEGER REFERENCES alert_rules(id) ON DELETE SET NULL,
    tenant_id VARCHAR(64) NOT NULL,
    
    -- Alert details
    severity VARCHAR(20) NOT NULL DEFAULT 'warning',
    title VARCHAR(500) NOT NULL,
    message TEXT,
    
    -- Threshold info
    threshold_type VARCHAR(50) NOT NULL,
    threshold_value NUMERIC(12, 4) NOT NULL,
    current_value NUMERIC(12, 4) NOT NULL,
    
    -- Delivery status
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    delivered_channels JSONB DEFAULT '[]'::jsonb,
    failed_channels JSONB DEFAULT '[]'::jsonb,
    delivery_errors JSONB DEFAULT '{}'::jsonb,
    
    -- Timestamps
    triggered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    acknowledged_at TIMESTAMPTZ,
    acknowledged_by VARCHAR(255)
);

CREATE INDEX IF NOT EXISTS idx_alert_history_tenant ON alert_history(tenant_id);
CREATE INDEX IF NOT EXISTS idx_alert_history_rule ON alert_history(rule_id);
CREATE INDEX IF NOT EXISTS idx_alert_history_triggered ON alert_history(triggered_at DESC);
CREATE INDEX IF NOT EXISTS idx_alert_history_status ON alert_history(status);
"""


def init_alert_tables(conn):
    """Initialize alert tables in database."""
    with conn.cursor() as cur:
        cur.execute(ALERT_TABLES_SQL)
        conn.commit()
    log.info("Alert tables initialized")
