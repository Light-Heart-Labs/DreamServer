"""
Token Spy Rate Limiter — Token Bucket Implementation

Phase 4c: Rate limiting infrastructure
- TokenBucket algorithm implementation
- Redis-backed storage with memory fallback
- Per-tenant rate limit tracking
"""

import os
import time
import logging
import threading
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Optional, Dict, Tuple

log = logging.getLogger("token-spy-rate-limiter")

# ── Configuration ───────────────────────────────────────────────────────────

REDIS_URL = os.environ.get("TOKEN_SPY_REDIS_URL", "redis://localhost:6379/0")
RATE_LIMIT_ENABLED = os.environ.get("TOKEN_SPY_RATE_LIMIT_ENABLED", "true").lower() == "true"
RATE_LIMIT_KEY_PREFIX = os.environ.get("TOKEN_SPY_RATE_LIMIT_PREFIX", "tokenspy:ratelimit:")


# ── Data Models ─────────────────────────────────────────────────────────────

@dataclass
class RateLimitResult:
    """Result of a rate limit check."""
    allowed: bool
    remaining: int
    limit: int
    reset_at: float  # Unix timestamp when bucket resets
    retry_after: Optional[int] = None  # Seconds to wait if rate limited
    
    @property
    def headers(self) -> Dict[str, str]:
        """Generate standard rate limit headers."""
        headers = {
            "X-RateLimit-Limit": str(self.limit),
            "X-RateLimit-Remaining": str(max(0, self.remaining)),
            "X-RateLimit-Reset": str(int(self.reset_at)),
        }
        if self.retry_after is not None:
            headers["Retry-After"] = str(self.retry_after)
        return headers


@dataclass
class BucketState:
    """Token bucket state."""
    tokens: float
    last_update: float
    
    def to_tuple(self) -> Tuple[float, float]:
        return (self.tokens, self.last_update)
    
    @classmethod
    def from_tuple(cls, data: Tuple[float, float]) -> "BucketState":
        return cls(tokens=data[0], last_update=data[1])


# ── Backend Interface ───────────────────────────────────────────────────────

class TokenBackend(ABC):
    """Abstract backend for token bucket storage."""
    
    @abstractmethod
    def get_bucket(self, key: str) -> Optional[BucketState]:
        """Get current bucket state."""
        pass
    
    @abstractmethod
    def set_bucket(self, key: str, state: BucketState, ttl_seconds: int) -> None:
        """Set bucket state with TTL."""
        pass
    
    @abstractmethod
    def is_available(self) -> bool:
        """Check if backend is available."""
        pass


class MemoryTokenBackend(TokenBackend):
    """In-memory token bucket storage.
    
    Thread-safe using locks. Suitable for single-instance deployments.
    Not suitable for distributed rate limiting.
    """
    
    def __init__(self):
        self._buckets: Dict[str, Tuple[BucketState, float]] = {}  # key -> (state, expires_at)
        self._lock = threading.Lock()
        self._cleanup_counter = 0
    
    def get_bucket(self, key: str) -> Optional[BucketState]:
        with self._lock:
            self._maybe_cleanup()
            
            entry = self._buckets.get(key)
            if entry is None:
                return None
            
            state, expires_at = entry
            if time.time() > expires_at:
                del self._buckets[key]
                return None
            
            return state
    
    def set_bucket(self, key: str, state: BucketState, ttl_seconds: int) -> None:
        with self._lock:
            expires_at = time.time() + ttl_seconds
            self._buckets[key] = (state, expires_at)
    
    def is_available(self) -> bool:
        return True
    
    def _maybe_cleanup(self) -> None:
        """Periodically clean up expired entries."""
        self._cleanup_counter += 1
        if self._cleanup_counter < 100:
            return
        
        self._cleanup_counter = 0
        now = time.time()
        expired = [k for k, (_, exp) in self._buckets.items() if now > exp]
        for k in expired:
            del self._buckets[k]


class RedisTokenBackend(TokenBackend):
    """Redis-backed token bucket storage.
    
    Suitable for distributed rate limiting across multiple instances.
    Uses Redis hash for atomic operations.
    """
    
    def __init__(self, redis_url: str = REDIS_URL):
        self._redis_url = redis_url
        self._client = None
        self._available = False
        self._connect()
    
    def _connect(self) -> None:
        """Attempt to connect to Redis."""
        try:
            import redis
            self._client = redis.from_url(
                self._redis_url,
                socket_connect_timeout=2,
                socket_timeout=1,
                decode_responses=True
            )
            # Test connection
            self._client.ping()
            self._available = True
            log.info(f"Redis connected for rate limiting: {self._redis_url}")
        except ImportError:
            log.warning("redis-py not installed, falling back to memory backend")
            self._available = False
        except Exception as e:
            log.warning(f"Redis connection failed, falling back to memory backend: {e}")
            self._available = False
    
    def get_bucket(self, key: str) -> Optional[BucketState]:
        if not self._available:
            return None
        
        try:
            data = self._client.hgetall(key)
            if not data:
                return None
            
            return BucketState(
                tokens=float(data.get("tokens", 0)),
                last_update=float(data.get("last_update", 0))
            )
        except Exception as e:
            log.error(f"Redis get_bucket error: {e}")
            return None
    
    def set_bucket(self, key: str, state: BucketState, ttl_seconds: int) -> None:
        if not self._available:
            return
        
        try:
            pipe = self._client.pipeline()
            pipe.hset(key, mapping={
                "tokens": str(state.tokens),
                "last_update": str(state.last_update)
            })
            pipe.expire(key, ttl_seconds)
            pipe.execute()
        except Exception as e:
            log.error(f"Redis set_bucket error: {e}")
    
    def is_available(self) -> bool:
        return self._available


# ── Token Bucket Implementation ─────────────────────────────────────────────

class TokenBucket:
    """Token bucket algorithm for rate limiting.
    
    Implements a sliding window token bucket where:
    - Tokens are added at a constant rate (capacity / window_seconds)
    - Each request consumes 1 token
    - Requests are denied when bucket is empty
    
    Args:
        capacity: Maximum tokens in bucket (burst limit)
        window_seconds: Time window for refill (60 for per-minute, 86400 for per-day)
        backend: Storage backend for bucket state
        key_prefix: Prefix for storage keys
    """
    
    def __init__(
        self,
        capacity: int,
        window_seconds: int,
        backend: TokenBackend,
        key_prefix: str = RATE_LIMIT_KEY_PREFIX
    ):
        self.capacity = capacity
        self.window_seconds = window_seconds
        self.backend = backend
        self.key_prefix = key_prefix
        
        # Refill rate: tokens per second
        self.refill_rate = capacity / window_seconds
    
    def _get_key(self, identifier: str, bucket_type: str) -> str:
        """Generate storage key for a bucket."""
        return f"{self.key_prefix}{bucket_type}:{identifier}"
    
    def consume(self, identifier: str, bucket_type: str = "default", tokens: int = 1) -> RateLimitResult:
        """Attempt to consume tokens from the bucket.
        
        Args:
            identifier: Unique identifier (e.g., tenant_id)
            bucket_type: Type of bucket (e.g., "rpm", "rpd")
            tokens: Number of tokens to consume
        
        Returns:
            RateLimitResult with allowed status and rate limit info
        """
        key = self._get_key(identifier, bucket_type)
        now = time.time()
        
        # Get current state
        state = self.backend.get_bucket(key)
        
        if state is None:
            # Initialize new bucket
            state = BucketState(
                tokens=float(self.capacity),
                last_update=now
            )
        else:
            # Refill tokens based on time elapsed
            elapsed = now - state.last_update
            refill = elapsed * self.refill_rate
            state.tokens = min(self.capacity, state.tokens + refill)
            state.last_update = now
        
        # Calculate reset time (when bucket will be full again)
        tokens_needed = self.capacity - state.tokens
        reset_at = now + (tokens_needed / self.refill_rate) if tokens_needed > 0 else now
        
        # Try to consume tokens
        if state.tokens >= tokens:
            state.tokens -= tokens
            self.backend.set_bucket(key, state, self.window_seconds * 2)
            
            return RateLimitResult(
                allowed=True,
                remaining=int(state.tokens),
                limit=self.capacity,
                reset_at=reset_at
            )
        else:
            # Calculate retry after (time until enough tokens available)
            tokens_short = tokens - state.tokens
            retry_after = int(tokens_short / self.refill_rate) + 1
            
            # Save state (to track partial refill)
            self.backend.set_bucket(key, state, self.window_seconds * 2)
            
            return RateLimitResult(
                allowed=False,
                remaining=0,
                limit=self.capacity,
                reset_at=now + retry_after,
                retry_after=retry_after
            )
    
    def peek(self, identifier: str, bucket_type: str = "default") -> RateLimitResult:
        """Check bucket status without consuming tokens."""
        key = self._get_key(identifier, bucket_type)
        now = time.time()
        
        state = self.backend.get_bucket(key)
        
        if state is None:
            return RateLimitResult(
                allowed=True,
                remaining=self.capacity,
                limit=self.capacity,
                reset_at=now
            )
        
        # Calculate current tokens with refill
        elapsed = now - state.last_update
        refill = elapsed * self.refill_rate
        current_tokens = min(self.capacity, state.tokens + refill)
        
        tokens_needed = self.capacity - current_tokens
        reset_at = now + (tokens_needed / self.refill_rate) if tokens_needed > 0 else now
        
        return RateLimitResult(
            allowed=current_tokens >= 1,
            remaining=int(current_tokens),
            limit=self.capacity,
            reset_at=reset_at
        )


# ── Rate Limiter Facade ─────────────────────────────────────────────────────

class RateLimiter:
    """High-level rate limiter facade for Token Spy.
    
    Manages multiple rate limit buckets per tenant:
    - RPM (requests per minute)
    - RPD (requests per day)
    
    Uses Redis if available, falls back to memory.
    """
    
    def __init__(
        self,
        redis_url: str = REDIS_URL,
        enabled: bool = RATE_LIMIT_ENABLED
    ):
        self.enabled = enabled
        
        if not enabled:
            log.info("Rate limiting disabled via configuration")
            self._backend = None
            return
        
        # Try Redis first, fallback to memory
        redis_backend = RedisTokenBackend(redis_url)
        if redis_backend.is_available():
            self._backend = redis_backend
            self._backend_type = "redis"
        else:
            self._backend = MemoryTokenBackend()
            self._backend_type = "memory"
            log.warning("Using in-memory rate limiting (not suitable for distributed deployments)")
    
    @property
    def backend_type(self) -> str:
        """Return the type of backend in use."""
        if not self.enabled:
            return "disabled"
        return self._backend_type
    
    def check_rate_limit(
        self,
        tenant_id: str,
        rpm_limit: Optional[int] = None,
        rpd_limit: Optional[int] = None
    ) -> RateLimitResult:
        """Check rate limits for a tenant.
        
        Checks both RPM and RPD limits and returns the most restrictive result.
        
        Args:
            tenant_id: Tenant identifier
            rpm_limit: Requests per minute limit (None = unlimited)
            rpd_limit: Requests per day limit (None = unlimited)
        
        Returns:
            RateLimitResult - if not allowed, includes which limit was hit
        """
        if not self.enabled:
            return RateLimitResult(
                allowed=True,
                remaining=999999,
                limit=999999,
                reset_at=time.time()
            )
        
        # Check RPM first (more likely to be hit)
        if rpm_limit is not None and rpm_limit > 0:
            rpm_bucket = TokenBucket(
                capacity=rpm_limit,
                window_seconds=60,
                backend=self._backend
            )
            rpm_result = rpm_bucket.consume(tenant_id, "rpm")
            
            if not rpm_result.allowed:
                log.debug(f"Tenant {tenant_id} hit RPM limit ({rpm_limit})")
                return rpm_result
        
        # Check RPD
        if rpd_limit is not None and rpd_limit > 0:
            rpd_bucket = TokenBucket(
                capacity=rpd_limit,
                window_seconds=86400,
                backend=self._backend
            )
            rpd_result = rpd_bucket.consume(tenant_id, "rpd")
            
            if not rpd_result.allowed:
                log.debug(f"Tenant {tenant_id} hit RPD limit ({rpd_limit})")
                return rpd_result
            
            # Return RPD result if RPM was unlimited
            if rpm_limit is None:
                return rpd_result
        
        # Return RPM result (or construct unlimited result)
        if rpm_limit is not None and rpm_limit > 0:
            return rpm_result
        
        return RateLimitResult(
            allowed=True,
            remaining=999999,
            limit=999999,
            reset_at=time.time()
        )
    
    def get_status(
        self,
        tenant_id: str,
        rpm_limit: Optional[int] = None,
        rpd_limit: Optional[int] = None
    ) -> Dict[str, RateLimitResult]:
        """Get current rate limit status without consuming tokens.
        
        Returns:
            Dict with 'rpm' and 'rpd' RateLimitResult entries
        """
        result = {}
        
        if not self.enabled:
            unlimited = RateLimitResult(
                allowed=True,
                remaining=999999,
                limit=999999,
                reset_at=time.time()
            )
            return {"rpm": unlimited, "rpd": unlimited}
        
        if rpm_limit is not None and rpm_limit > 0:
            rpm_bucket = TokenBucket(
                capacity=rpm_limit,
                window_seconds=60,
                backend=self._backend
            )
            result["rpm"] = rpm_bucket.peek(tenant_id, "rpm")
        
        if rpd_limit is not None and rpd_limit > 0:
            rpd_bucket = TokenBucket(
                capacity=rpd_limit,
                window_seconds=86400,
                backend=self._backend
            )
            result["rpd"] = rpd_bucket.peek(tenant_id, "rpd")
        
        return result


# ── Global Instance ─────────────────────────────────────────────────────────

# Lazy-initialized global rate limiter
_rate_limiter: Optional[RateLimiter] = None


def get_rate_limiter() -> RateLimiter:
    """Get or create the global rate limiter instance."""
    global _rate_limiter
    if _rate_limiter is None:
        _rate_limiter = RateLimiter()
    return _rate_limiter
