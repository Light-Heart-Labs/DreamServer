"""
Extended PII Recognizers for Privacy Shield
Adds detection for API keys, cloud credentials, and secrets.

To deploy: Copy to ~/privacy-shield/custom_recognizers.py on .122
"""

from presidio_analyzer import Pattern, PatternRecognizer


# ============================================================================
# EXISTING RECOGNIZERS (keep these)
# ============================================================================

class SSNRecognizer(PatternRecognizer):
    """US Social Security Numbers in various formats."""
    
    PATTERNS = [
        Pattern("SSN-dashes", r"\b\d{3}-\d{2}-\d{4}\b", 0.85),
        Pattern("SSN-spaces", r"\b\d{3}\s\d{2}\s\d{4}\b", 0.85),
        Pattern("SSN-solid", r"\b\d{9}\b", 0.4),
    ]
    
    CONTEXT = ["ssn", "social security", "social", "security number", "ss#"]
    
    def __init__(self):
        super().__init__(
            supported_entity="US_SSN",
            patterns=self.PATTERNS,
            context=self.CONTEXT,
            supported_language="en",
        )


class FilenameRecognizer(PatternRecognizer):
    """Names embedded in filenames (case-insensitive)."""
    
    PATTERNS = [
        Pattern(
            "name-in-filename",
            r"(?i)\b[a-z]+[_-][a-z]+[_-](?:resume|cv|photo|doc|file|report)\.[a-z]+\b",
            0.6
        ),
    ]
    
    def __init__(self):
        super().__init__(
            supported_entity="FILENAME_WITH_NAME",
            patterns=self.PATTERNS,
            context=["file", "document", "attachment"],
            supported_language="en",
        )


# ============================================================================
# NEW: API KEY RECOGNIZERS
# ============================================================================

class OpenAIKeyRecognizer(PatternRecognizer):
    """OpenAI API keys: sk-xxx format."""
    
    PATTERNS = [
        Pattern("openai-key", r"\bsk-[a-zA-Z0-9]{20,}\b", 0.95),
        Pattern("openai-proj-key", r"\bsk-proj-[a-zA-Z0-9]{20,}\b", 0.95),
    ]
    
    CONTEXT = ["openai", "api key", "api_key", "apikey", "bearer", "authorization"]
    
    def __init__(self):
        super().__init__(
            supported_entity="API_KEY",
            patterns=self.PATTERNS,
            context=self.CONTEXT,
            supported_language="en",
        )


class AnthropicKeyRecognizer(PatternRecognizer):
    """Anthropic API keys."""
    
    PATTERNS = [
        Pattern("anthropic-key", r"\bsk-ant-[a-zA-Z0-9\-_]{20,}\b", 0.95),
    ]
    
    CONTEXT = ["anthropic", "claude", "api key", "api_key"]
    
    def __init__(self):
        super().__init__(
            supported_entity="API_KEY",
            patterns=self.PATTERNS,
            context=self.CONTEXT,
            supported_language="en",
        )


class GitHubTokenRecognizer(PatternRecognizer):
    """GitHub personal access tokens and fine-grained tokens."""
    
    PATTERNS = [
        Pattern("github-pat", r"\bghp_[a-zA-Z0-9]{36}\b", 0.95),
        Pattern("github-fine-grained", r"\bgithub_pat_[a-zA-Z0-9]{22}_[a-zA-Z0-9]{59}\b", 0.95),
        Pattern("github-oauth", r"\bgho_[a-zA-Z0-9]{36}\b", 0.95),
        Pattern("github-app", r"\bghs_[a-zA-Z0-9]{36}\b", 0.90),
    ]
    
    CONTEXT = ["github", "git", "token", "pat", "personal access"]
    
    def __init__(self):
        super().__init__(
            supported_entity="API_KEY",
            patterns=self.PATTERNS,
            context=self.CONTEXT,
            supported_language="en",
        )


class SlackTokenRecognizer(PatternRecognizer):
    """Slack bot and user tokens."""
    
    PATTERNS = [
        Pattern("slack-bot", r"\bxoxb-[0-9]{10,13}-[0-9]{10,13}-[a-zA-Z0-9]{24}\b", 0.95),
        Pattern("slack-user", r"\bxoxp-[0-9]{10,13}-[0-9]{10,13}-[a-zA-Z0-9]{24}\b", 0.95),
        Pattern("slack-app", r"\bxapp-[0-9]-[A-Z0-9]{10,}-[0-9]{10,}-[a-zA-Z0-9]{32,}\b", 0.90),
    ]
    
    CONTEXT = ["slack", "token", "bot", "webhook"]
    
    def __init__(self):
        super().__init__(
            supported_entity="API_KEY",
            patterns=self.PATTERNS,
            context=self.CONTEXT,
            supported_language="en",
        )


class DiscordTokenRecognizer(PatternRecognizer):
    """Discord bot tokens (base64 encoded user ID + timestamp + HMAC)."""
    
    PATTERNS = [
        # Discord tokens are 3 parts separated by dots: [base64].[base64].[base64]
        Pattern(
            "discord-token",
            r"\b[MN][A-Za-z0-9]{23,28}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{27,40}\b",
            0.85
        ),
    ]
    
    CONTEXT = ["discord", "bot", "token", "bearer"]
    
    def __init__(self):
        super().__init__(
            supported_entity="API_KEY",
            patterns=self.PATTERNS,
            context=self.CONTEXT,
            supported_language="en",
        )


# ============================================================================
# NEW: CLOUD CREDENTIAL RECOGNIZERS
# ============================================================================

class AWSAccessKeyRecognizer(PatternRecognizer):
    """AWS Access Key IDs."""
    
    PATTERNS = [
        Pattern("aws-access-key", r"\bAKIA[0-9A-Z]{16}\b", 0.95),
        Pattern("aws-temp-key", r"\bASIA[0-9A-Z]{16}\b", 0.90),
    ]
    
    CONTEXT = ["aws", "amazon", "access key", "access_key", "s3", "ec2"]
    
    def __init__(self):
        super().__init__(
            supported_entity="CLOUD_CREDENTIAL",
            patterns=self.PATTERNS,
            context=self.CONTEXT,
            supported_language="en",
        )


class AWSSecretKeyRecognizer(PatternRecognizer):
    """AWS Secret Access Keys (40 char base64-ish)."""
    
    PATTERNS = [
        # AWS secret keys are 40 chars, alphanumeric + /+
        Pattern(
            "aws-secret-key",
            r"\b[A-Za-z0-9/+=]{40}\b",
            0.5  # Lower confidence - needs context
        ),
    ]
    
    CONTEXT = ["aws_secret", "secret_key", "secret_access_key", "aws secret", "amazon"]
    
    def __init__(self):
        super().__init__(
            supported_entity="CLOUD_CREDENTIAL",
            patterns=self.PATTERNS,
            context=self.CONTEXT,
            supported_language="en",
        )


class AzureKeyRecognizer(PatternRecognizer):
    """Azure subscription keys and storage account keys."""
    
    PATTERNS = [
        # Azure storage keys (88 chars base64 ending in ==)
        Pattern("azure-storage-key", r"\b[A-Za-z0-9+/]{86}==\b", 0.85),
        # Azure subscription keys (32 hex chars)
        Pattern("azure-subscription-key", r"\b[a-f0-9]{32}\b", 0.4),
    ]
    
    CONTEXT = ["azure", "microsoft", "storage", "subscription", "cognitive"]
    
    def __init__(self):
        super().__init__(
            supported_entity="CLOUD_CREDENTIAL",
            patterns=self.PATTERNS,
            context=self.CONTEXT,
            supported_language="en",
        )


class GCPKeyRecognizer(PatternRecognizer):
    """Google Cloud Platform API keys."""
    
    PATTERNS = [
        Pattern("gcp-api-key", r"\bAIza[0-9A-Za-z\-_]{35}\b", 0.95),
    ]
    
    CONTEXT = ["google", "gcp", "gcloud", "api key", "firebase"]
    
    def __init__(self):
        super().__init__(
            supported_entity="CLOUD_CREDENTIAL",
            patterns=self.PATTERNS,
            context=self.CONTEXT,
            supported_language="en",
        )


# ============================================================================
# NEW: SECRETS AND CREDENTIALS
# ============================================================================

class PrivateKeyRecognizer(PatternRecognizer):
    """Private key headers (RSA, DSA, EC, etc.)."""
    
    PATTERNS = [
        Pattern(
            "private-key-header",
            r"-----BEGIN (?:RSA |DSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----",
            0.99
        ),
        Pattern(
            "pgp-private-key",
            r"-----BEGIN PGP PRIVATE KEY BLOCK-----",
            0.99
        ),
    ]
    
    CONTEXT = ["key", "private", "ssh", "pgp", "rsa", "certificate"]
    
    def __init__(self):
        super().__init__(
            supported_entity="PRIVATE_KEY",
            patterns=self.PATTERNS,
            context=self.CONTEXT,
            supported_language="en",
        )


class JWTRecognizer(PatternRecognizer):
    """JSON Web Tokens (often contain user data in payload)."""
    
    PATTERNS = [
        # JWT: base64.base64.base64 format
        Pattern(
            "jwt-token",
            r"\beyJ[a-zA-Z0-9_-]*\.eyJ[a-zA-Z0-9_-]*\.[a-zA-Z0-9_-]+\b",
            0.90
        ),
    ]
    
    CONTEXT = ["jwt", "token", "bearer", "authorization", "auth"]
    
    def __init__(self):
        super().__init__(
            supported_entity="JWT_TOKEN",
            patterns=self.PATTERNS,
            context=self.CONTEXT,
            supported_language="en",
        )


class ConnectionStringRecognizer(PatternRecognizer):
    """Database connection strings with embedded credentials."""
    
    PATTERNS = [
        # PostgreSQL/MySQL/MongoDB connection strings
        Pattern(
            "db-connection-string",
            r"(?:postgres|mysql|mongodb|mongodb\+srv)://[^:]+:[^@]+@[^\s]+",
            0.95
        ),
        # Redis
        Pattern(
            "redis-connection",
            r"redis://[^:]*:[^@]+@[^\s]+",
            0.90
        ),
    ]
    
    CONTEXT = ["database", "connection", "db", "postgres", "mysql", "mongo", "redis"]
    
    def __init__(self):
        super().__init__(
            supported_entity="CONNECTION_STRING",
            patterns=self.PATTERNS,
            context=self.CONTEXT,
            supported_language="en",
        )


class PasswordInURLRecognizer(PatternRecognizer):
    """Passwords embedded in URLs (user:password@host)."""
    
    PATTERNS = [
        Pattern(
            "password-in-url",
            r"://[^:]+:[^@\s]+@",
            0.80
        ),
    ]
    
    CONTEXT = ["url", "http", "ftp", "connection"]
    
    def __init__(self):
        super().__init__(
            supported_entity="PASSWORD_IN_URL",
            patterns=self.PATTERNS,
            context=self.CONTEXT,
            supported_language="en",
        )


# ============================================================================
# NEW: INTERNAL INFRASTRUCTURE
# ============================================================================

class InternalIPRecognizer(PatternRecognizer):
    """Internal/private IP address ranges with valid octet validation (0-255)."""
    
    # Octet pattern: 0-255
    _OCTET = r"(?:25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])"
    
    PATTERNS = [
        # 10.x.x.x (valid octets only)
        Pattern("internal-ip-10", rf"\b10\.{_OCTET}\.{_OCTET}\.{_OCTET}\b", 0.70),
        # 172.16-31.x.x (valid octets only)
        Pattern("internal-ip-172", rf"\b172\.(1[6-9]|2[0-9]|3[01])\.{_OCTET}\.{_OCTET}\b", 0.70),
        # 192.168.x.x (valid octets only)
        Pattern("internal-ip-192", rf"\b192\.168\.{_OCTET}\.{_OCTET}\b", 0.70),
    ]
    
    CONTEXT = ["server", "host", "ip", "address", "network", "internal", "private"]
    
    def __init__(self):
        super().__init__(
            supported_entity="INTERNAL_IP",
            patterns=self.PATTERNS,
            context=self.CONTEXT,
            supported_language="en",
        )


class InternalHostnameRecognizer(PatternRecognizer):
    """Internal hostnames and domains (case-insensitive)."""
    
    PATTERNS = [
        # Common internal domain patterns (case-insensitive via (?i))
        Pattern("internal-domain", r"(?i)\b[a-z0-9-]+\.(?:internal|local|corp|intranet)\b", 0.75),
        Pattern("localhost-port", r"(?i)\blocalhost:\d+\b", 0.80),
    ]
    
    CONTEXT = ["server", "host", "domain", "internal", "dev", "staging", "prod"]
    
    def __init__(self):
        super().__init__(
            supported_entity="INTERNAL_HOSTNAME",
            patterns=self.PATTERNS,
            context=self.CONTEXT,
            supported_language="en",
        )


# ============================================================================
# REGISTRY FUNCTION
# ============================================================================

def get_custom_recognizers():
    """Return list of all custom recognizers to add to the analyzer."""
    return [
        # Original
        SSNRecognizer(),
        FilenameRecognizer(),
        # API Keys
        OpenAIKeyRecognizer(),
        AnthropicKeyRecognizer(),
        GitHubTokenRecognizer(),
        SlackTokenRecognizer(),
        DiscordTokenRecognizer(),
        # Cloud Credentials
        AWSAccessKeyRecognizer(),
        AWSSecretKeyRecognizer(),
        AzureKeyRecognizer(),
        GCPKeyRecognizer(),
        # Secrets
        PrivateKeyRecognizer(),
        JWTRecognizer(),
        ConnectionStringRecognizer(),
        PasswordInURLRecognizer(),
        # Infrastructure
        InternalIPRecognizer(),
        InternalHostnameRecognizer(),
    ]


# List of all entity types for reference
EXTENDED_ENTITIES = [
    "US_SSN",
    "FILENAME_WITH_NAME",
    "API_KEY",
    "CLOUD_CREDENTIAL",
    "PRIVATE_KEY",
    "JWT_TOKEN",
    "CONNECTION_STRING",
    "PASSWORD_IN_URL",
    "INTERNAL_IP",
    "INTERNAL_HOSTNAME",
]
