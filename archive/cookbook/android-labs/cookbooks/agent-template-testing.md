# Testing Agent Template

An automated testing specialist that generates test cases, runs validation, and reports coverage. Designed to improve code quality and catch bugs before they reach production.

---

## Agent Purpose

The Testing Agent acts as a dedicated quality assurance engineer within your OpenClaw environment. It:

- **Generates test cases** automatically from source code analysis
- **Runs test suites** and validates results
- **Reports coverage metrics** with actionable insights
- **Identifies untested code paths** and edge cases
- **Suggests improvements** for test quality and completeness

### When to Use This Agent

| Scenario | How the Agent Helps |
|----------|---------------------|
| New feature development | Generate comprehensive test suites for new code |
| Legacy codebase maintenance | Identify untested code and create missing tests |
| Pre-release validation | Run full test suites and report coverage gaps |
| Code review preparation | Verify existing tests still pass and cover changes |
| Refactoring safety net | Ensure behavior is preserved through test validation |
| CI/CD integration | Automated testing in deployment pipelines |

---

## Required Configuration

### System Prompt

```yaml
name: testing-agent
version: 1.0.0
description: Automated testing specialist for code validation and coverage analysis

system_prompt: |
  You are a Testing Agent specialized in software quality assurance.
  
  Your responsibilities:
  1. Analyze code to understand functionality and identify testable behaviors
  2. Generate comprehensive test cases covering happy paths, edge cases, and error conditions
  3. Execute test suites and interpret results
  4. Report coverage metrics with specific line-by-line analysis
  5. Suggest improvements for test quality and maintainability
  
  Guidelines:
  - Always validate test syntax before execution
  - Prioritize testing critical paths and public APIs
  - Include both positive and negative test cases
  - Report specific line numbers for uncovered code
  - Maintain test isolation and independence
  - Use descriptive test names that explain the behavior being tested
  
  When generating tests:
  - Match the testing framework already in use (pytest, jest, unittest, etc.)
  - Follow existing naming conventions and patterns
  - Include setup/teardown when necessary
  - Mock external dependencies appropriately
  - Add docstrings explaining test purpose

model:
  # Recommended: A model with strong code understanding
  # Options: claude-3.5-sonnet, gpt-4, kimi-k2.5, codellama
  name: claude-3.5-sonnet
  temperature: 0.2  # Lower for consistent, deterministic test generation
  
tools:
  # Required tools for the Testing Agent
  required:
    - read          # Read source files to analyze
    - write         # Write test files
    - edit          # Modify existing tests
    - exec          # Execute test commands
  
  # Optional but recommended
  optional:
    - web_search    # Research testing patterns and best practices
    - web_fetch     # Access testing documentation
```

### Environment Setup

```bash
# Required environment variables
export TESTING_AGENT_WORKSPACE="./tests"      # Default test directory
export TESTING_AGENT_FRAMEWORK="pytest"       # Default testing framework
export TESTING_AGENT_COVERAGE_THRESHOLD=80    # Minimum coverage percentage
export TESTING_AGENT_AUTO_FIX="false"         # Auto-fix failing tests (dangerous)
```

### Agent Definition (agents.yaml)

```yaml
agents:
  testing:
    name: "Testing Agent"
    description: "Generate and run tests, report coverage"
    prompt_template: testing-agent
    model: claude-3.5-sonnet
    temperature: 0.2
    tools:
      - read
      - write
      - edit
      - exec
    working_directory: "./tests"
    
    # Agent-specific configuration
    config:
      default_framework: pytest
      coverage_threshold: 80
      test_patterns:
        - "test_*.py"
        - "*_test.py"
      ignore_patterns:
        - "__pycache__"
        - ".pytest_cache"
```

---

## Sample Conversation

The following demonstrates a Testing Agent in action:

### User Request

```
User: @testing-agent Please generate tests for the new payment processing 
module in src/payments/processor.py. We need at least 80% coverage.
```

### Agent Response

```
Testing Agent: I'll analyze the payment processor module and generate 
comprehensive tests. Let me start by reading the source code.

<read file_path="src/payments/processor.py">
```

**[Agent reads and analyzes the file...]**

```
Testing Agent: I can see the PaymentProcessor class with several methods:
- process_payment()
- refund_payment()
- validate_card()
- get_transaction_status()

I'll now generate a comprehensive test suite covering:
- Successful payment processing
- Invalid card validation
- Error handling for network failures
- Refund scenarios
- Transaction status retrieval

<write file_path="tests/payments/test_processor.py" content="...">
```

**[Agent writes test file...]**

```python
"""
Tests for the payment processing module.

This module tests the PaymentProcessor class including:
- Payment processing workflows
- Card validation logic
- Error handling and edge cases
- Refund operations
"""

import pytest
from unittest.mock import Mock, patch, MagicMock
from src.payments.processor import PaymentProcessor, PaymentError
from src.payments.models import PaymentRequest, CardDetails


class TestPaymentProcessor:
    """Test suite for PaymentProcessor class."""
    
    @pytest.fixture
    def processor(self):
        """Create a PaymentProcessor instance for testing."""
        return PaymentProcessor(api_key="test_key", environment="sandbox")
    
    @pytest.fixture
    def valid_payment_request(self):
        """Create a valid payment request for testing."""
        return PaymentRequest(
            amount=100.00,
            currency="USD",
            card=CardDetails(
                number="4111111111111111",
                expiry_month="12",
                expiry_year="2025",
                cvv="123"
            ),
            description="Test payment"
        )
    
    def test_process_payment_success(self, processor, valid_payment_request):
        """Test successful payment processing."""
        # Mock the payment gateway response
        mock_response = {
            "status": "approved",
            "transaction_id": "txn_123456",
            "amount": 100.00
        }
        
        with patch.object(processor, '_call_gateway', return_value=mock_response):
            result = processor.process_payment(valid_payment_request)
        
        assert result.status == "approved"
        assert result.transaction_id == "txn_123456"
        assert result.amount == 100.00
    
    def test_process_payment_invalid_card(self, processor):
        """Test payment rejection with invalid card details."""
        invalid_request = PaymentRequest(
            amount=100.00,
            currency="USD",
            card=CardDetails(
                number="1234567890123456",  # Invalid Luhn checksum
                expiry_month="12",
                expiry_year="2020",  # Expired
                cvv="12"  # Invalid CVV length
            )
        )
        
        with pytest.raises(PaymentError) as exc_info:
            processor.process_payment(invalid_request)
        
        assert "Invalid card details" in str(exc_info.value)
    
    def test_process_payment_insufficient_funds(self, processor, valid_payment_request):
        """Test handling of insufficient funds error."""
        mock_response = {
            "status": "declined",
            "error_code": "insufficient_funds",
            "error_message": "Card has insufficient funds"
        }
        
        with patch.object(processor, '_call_gateway', return_value=mock_response):
            with pytest.raises(PaymentError) as exc_info:
                processor.process_payment(valid_payment_request)
        
        assert "insufficient_funds" in str(exc_info.value)
    
    def test_process_payment_network_error(self, processor, valid_payment_request):
        """Test handling of network connectivity issues."""
        with patch.object(
            processor, 
            '_call_gateway', 
            side_effect=ConnectionError("Network unreachable")
        ):
            with pytest.raises(PaymentError) as exc_info:
                processor.process_payment(valid_payment_request)
        
        assert "Network error" in str(exc_info.value)
        assert processor.is_retryable(str(exc_info.value)) is True
    
    def test_refund_payment_success(self, processor):
        """Test successful refund processing."""
        transaction_id = "txn_123456"
        mock_response = {
            "status": "refunded",
            "refund_id": "ref_789012",
            "amount": 100.00
        }
        
        with patch.object(processor, '_call_gateway', return_value=mock_response):
            result = processor.refund_payment(transaction_id, amount=100.00)
        
        assert result.status == "refunded"
        assert result.refund_id == "ref_789012"
    
    def test_refund_payment_partial(self, processor):
        """Test partial refund processing."""
        transaction_id = "txn_123456"
        mock_response = {
            "status": "partially_refunded",
            "refund_id": "ref_789013",
            "amount": 50.00
        }
        
        with patch.object(processor, '_call_gateway', return_value=mock_response):
            result = processor.refund_payment(transaction_id, amount=50.00)
        
        assert result.status == "partially_refunded"
        assert result.amount == 50.00
    
    def test_validate_card_valid(self, processor):
        """Test card validation with valid card number."""
        card = CardDetails(
            number="4111111111111111",
            expiry_month="12",
            expiry_year="2025",
            cvv="123"
        )
        
        assert processor.validate_card(card) is True
    
    @pytest.mark.parametrize("card_number,expected_valid", [
        ("4111111111111111", True),   # Valid Visa test card
        ("378282246310005", True),    # Valid Amex test card
        ("1234567890123456", False),  # Invalid checksum
        ("4111111111111112", False),  # Invalid checksum (off by one)
        ("", False),                   # Empty string
        ("abc", False),                # Non-numeric
    ])
    def test_validate_card_various_numbers(self, processor, card_number, expected_valid):
        """Test card validation with various card numbers."""
        card = CardDetails(
            number=card_number,
            expiry_month="12",
            expiry_year="2025",
            cvv="123"
        )
        
        assert processor.validate_card(card) == expected_valid
    
    def test_validate_card_expired(self, processor):
        """Test card validation with expired card."""
        card = CardDetails(
            number="4111111111111111",
            expiry_month="01",
            expiry_year="2020",  # Past date
            cvv="123"
        )
        
        assert processor.validate_card(card) is False
    
    def test_get_transaction_status_success(self, processor):
        """Test retrieving transaction status."""
        transaction_id = "txn_123456"
        mock_response = {
            "transaction_id": transaction_id,
            "status": "completed",
            "amount": 100.00,
            "created_at": "2024-01-15T10:30:00Z"
        }
        
        with patch.object(processor, '_call_gateway', return_value=mock_response):
            result = processor.get_transaction_status(transaction_id)
        
        assert result.transaction_id == transaction_id
        assert result.status == "completed"
    
    def test_get_transaction_status_not_found(self, processor):
        """Test handling of non-existent transaction."""
        transaction_id = "txn_nonexistent"
        mock_response = {
            "error": "Transaction not found",
            "error_code": "not_found"
        }
        
        with patch.object(processor, '_call_gateway', return_value=mock_response):
            with pytest.raises(PaymentError) as exc_info:
                processor.get_transaction_status(transaction_id)
        
        assert "not_found" in str(exc_info.value)


class TestPaymentProcessorConfiguration:
    """Test suite for PaymentProcessor configuration and setup."""
    
    def test_initialization_with_valid_config(self):
        """Test processor initialization with valid configuration."""
        processor = PaymentProcessor(
            api_key="test_key",
            environment="sandbox"
        )
        
        assert processor.api_key == "test_key"
        assert processor.environment == "sandbox"
        assert processor.timeout == 30  # Default timeout
    
    def test_initialization_with_production_environment(self):
        """Test processor initialization for production."""
        processor = PaymentProcessor(
            api_key="prod_key",
            environment="production",
            timeout=60
        )
        
        assert processor.environment == "production"
        assert processor.timeout == 60
    
    def test_initialization_missing_api_key(self):
        """Test processor initialization without API key."""
        with pytest.raises(ValueError) as exc_info:
            PaymentProcessor(api_key="", environment="sandbox")
        
        assert "API key is required" in str(exc_info.value)


class TestPaymentProcessorRetryLogic:
    """Test suite for retry and error handling logic."""
    
    @pytest.fixture
    def processor(self):
        return PaymentProcessor(api_key="test_key", environment="sandbox")
    
    def test_is_retryable_network_errors(self, processor):
        """Test identification of retryable network errors."""
        retryable_errors = [
            "Connection timeout",
            "Network unreachable",
            "Temporary failure",
            "503 Service Unavailable"
        ]
        
        for error in retryable_errors:
            assert processor.is_retryable(error) is True, f"{error} should be retryable"
    
    def test_is_retryable_non_retryable_errors(self, processor):
        """Test identification of non-retryable errors."""
        non_retryable_errors = [
            "Invalid API key",
            "Card declined",
            "Insufficient funds",
            "Transaction not found"
        ]
        
        for error in non_retryable_errors:
            assert processor.is_retryable(error) is False, f"{error} should not be retryable"
```

### Running Tests and Coverage

```
Testing Agent: Now let me run the tests and generate a coverage report.

<exec command="cd /home/michael/.openclaw/workspace && python -m pytest tests/payments/test_processor.py -v --cov=src.payments.processor --cov-report=term-missing">
```

**[Test execution output...]**

```
Testing Agent: ✅ All 16 tests passed!

Coverage Report:
- Overall coverage: 87%
- processor.py: 87% (13 lines missing)

Missing coverage on lines:
- 142-145: Exception logging in _call_gateway()
- 178-181: Webhook signature validation
- 203: Timeout handling edge case

Recommendations:
1. Add test for webhook signature validation failure
2. Add test for timeout retry exhaustion
3. Add integration test with actual sandbox API

Would you like me to:
1. Add tests for the uncovered lines?
2. Generate integration tests for the sandbox API?
3. Set up a GitHub Action to run these tests automatically?
```

---

## Integration Notes

### OpenClaw Integration

Add the Testing Agent to your `openclaw.yaml`:

```yaml
# openclaw.yaml
agents:
  testing:
    enabled: true
    template: cookbook/agent-template-testing.md
    triggers:
      # Auto-run on file changes (optional)
      - type: file_change
        patterns:
          - "src/**/*.py"
        exclude:
          - "**/__pycache__/**"
      
      # Manual trigger via mention
      - type: mention
        patterns:
          - "@testing-agent"
          - "@test"
    
    # Pre-test hooks
    hooks:
      pre_test:
        - "pip install -r requirements-test.txt"
        - "python -m pytest --collect-only -q"  # Validate test discovery
      
      post_test:
        - "coverage html"  # Generate HTML report
        - "coverage xml"   # Generate XML report for CI

notifications:
  coverage_drop:
    threshold: 5  # Alert if coverage drops by 5%
    channels:
      - discord
      - email
```

### CLI Commands

```bash
# Run testing agent on specific file
openclaw agent testing --file src/payments/processor.py

# Run testing agent with coverage threshold
openclaw agent testing --file src/payments/processor.py --coverage 90

# Generate tests for entire module
openclaw agent testing --module src/payments --recursive

# Run existing tests only
openclaw agent testing --run-only --path tests/
```

### CI/CD Integration

**GitHub Actions Example:**

```yaml
# .github/workflows/testing-agent.yml
name: Testing Agent

on:
  pull_request:
    paths:
      - 'src/**/*.py'

jobs:
  test-generation:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Setup OpenClaw
        uses: openclaw/setup-action@v1
        with:
          api-key: ${{ secrets.OPENCLAW_API_KEY }}
      
      - name: Run Testing Agent
        run: |
          openclaw agent testing \
            --diff ${{ github.event.pull_request.diff_url }} \
            --coverage-threshold 80 \
            --comment-on-pr
```

### Best Practices

1. **Start Small**: Begin with unit tests for new features, then expand to integration tests
2. **Mock External Services**: Always mock payment gateways, databases, and external APIs
3. **Test Data**: Use factory patterns or fixtures for consistent test data
4. **Naming**: Follow `test_<method>_<scenario>` naming convention
5. **Coverage Gates**: Set minimum coverage thresholds in CI to prevent regressions
6. **Review Generated Tests**: Always review AI-generated tests before committing
7. **Keep Tests Fast**: Unit tests should run in <100ms each

### Troubleshooting

| Issue | Solution |
|-------|----------|
| Tests fail in CI but pass locally | Check environment differences, mocked dependencies |
| Coverage inaccurate | Ensure `coverage` is installed, use `--cov-append` |
| Slow test execution | Use `pytest-xdist` for parallel execution |
| Flaky tests | Add retry logic, fix race conditions, use deterministic data |

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | 2024-02-12 | Initial template release |

---

*Template maintained by the OpenClaw community. Submit improvements via PR.*
