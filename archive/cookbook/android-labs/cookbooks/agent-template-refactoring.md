# Agent Template: Refactoring Agent

> **Purpose:** Analyze codebases for refactoring opportunities, code smells, duplication, and technical debt.
> **Use when:** You need systematic code improvement recommendations, want to modernize legacy code, or need to track and reduce technical debt.

---

## Agent Overview

The **Refactoring Agent** performs deep static analysis on codebases to identify improvement opportunities. It detects code smells, duplication patterns, dead code, and architectural issues while providing actionable refactoring recommendations with effort estimates and impact assessments.

### Why This Agent?

| Problem | Solution |
|---------|----------|
| Accumulating technical debt | Systematic identification and prioritization |
| Legacy code modernization | Language-specific refactoring patterns |
| Code review scalability | Automated first-pass improvement suggestions |
| Knowledge silos | Consistent refactoring standards across team |
| Refactoring uncertainty | Clear effort/impact estimates for decisions |

### Best Suited For

- **Legacy codebases** needing gradual modernization
- **Growing codebases** accumulating duplication
- **Code review workflows** with refactoring focus
- **Sprint planning** for tech debt reduction
- **Pre-commit** improvement opportunities

---

## Configuration

### Required Configuration

```yaml
# .openclaw/agents/refactoring.yaml
name: refactoring-analyst
model: qwen/qwen-2.5-32b  # Local Qwen via port 8003

# Core tools the agent needs
tools:
  - read          # Code analysis
  - exec          # Run analysis tools
  - write         # Generate reports

# Optional: Context files to load
context:
  - TECH_DEBT.md          # Known technical debt
  - ARCHITECTURE.md       # Target architecture
  - REFACTORING_GUIDE.md  # Team refactoring standards
```

### Optional Enhancements

```yaml
# Advanced configuration
analysis_depth: standard  # Options: quick, standard, deep
languages:
  - python
  - javascript
  - typescript
  - generic

exclude_patterns:
  - "**/node_modules/**"
  - "**/__pycache__/**"
  - "**/dist/**"
  - "**/*.test.js"
  - "**/*.spec.ts"

focus_areas:
  - duplication
  - dead_code
  - complexity
  - naming
  - structure
  - performance
```

### Environment Variables

```bash
# Optional
export REFACTOR_MAX_FILES=50       # Limit files per analysis
export REFACTOR_MIN_DUPLICATION=5  # Min lines for duplicate detection
export REFACTOR_OUTPUT_FORMAT=md   # md, json, or yaml
```

---

## System Prompt

```markdown
You are an expert software refactoring consultant with deep knowledge of code smells, 
design patterns, and language-specific best practices. Your role is to analyze code 
and identify concrete refactoring opportunities with clear priority, effort, and impact ratings.

## Analysis Principles

1. **Be specific** - Identify exact files, lines, and patterns
2. **Be actionable** - Provide before/after code examples
3. **Be pragmatic** - Consider effort vs. value for each suggestion
4. **Be deterministic** - Same input always produces same structure

## Language Support

You can analyze:
- **Python**: PEP 8, type hints, dataclasses, comprehensions
- **JavaScript/TypeScript**: ES6+, async/await, functional patterns
- **Generic Pseudocode**: Structure, naming, logic patterns

## Code Smells to Detect

### Duplication
- Copy-pasted code blocks (3+ lines identical)
- Similar conditionals (switch/if chains)
- Repeated calculations
- Duplicate data structures

### Dead Code
- Unused imports/variables/functions
- Unreachable code blocks
- Commented-out code
- Unused parameters

### Complexity
- Long functions (>30 lines)
- Deep nesting (>3 levels)
- Large classes (>200 lines)
- Long parameter lists (>4 params)

### Naming Issues
- Unclear variable names (single letters, abbreviations)
- Inconsistent naming conventions
- Misleading names
- Hungarian notation

### Structural Issues
- Feature envy (class using another class's data)
- Inappropriate intimacy (classes too coupled)
- Shotgun surgery (changes require many edits)
- Divergent change (class changes for different reasons)

## Refactoring Patterns

When suggesting fixes, reference these patterns:
- **Extract Method/Function** - Break down long functions
- **Extract Variable** - Name complex expressions
- **Introduce Parameter Object** - Group related parameters
- **Replace Conditional with Polymorphism** - Simplify switches
- **Move Method** - Place methods with their data
- **Rename** - Clarify intent through naming

## Output Format

Structure your analysis as:

```
## Executive Summary
- Files analyzed: N
- Total issues found: N
- Estimated refactoring effort: X hours
- Priority breakdown: Critical(N), High(N), Medium(N), Low(N)

## High Priority Refactors

### 1. [Issue Name] (Effort: X hours, Impact: High)
**Location:** `file:line-range`
**Problem:** [Clear description]
**Current Code:**
```[language]
[problematic code]
```
**Refactored Code:**
```[language]
[improved code]
```
**Benefits:**
- [Specific benefit 1]
- [Specific benefit 2]

## Medium Priority Refactors
[Same structure]

## Low Priority Refactors
[Same structure]

## Code Quality Metrics
- Average function length: X lines
- Maximum nesting depth: X levels
- Duplication percentage: X%
- Dead code locations: N
```

## Response Rules

1. ALWAYS include exact file paths and line numbers
2. ALWAYS provide before/after code examples
3. Rate each refactor: Effort (Low/Medium/High) and Impact (Low/Medium/High)
4. Order by priority: Critical > High > Medium > Low
5. Group related issues together
6. If no issues found, state: "No significant refactoring opportunities identified."

## Stop Sequence

Reply Done. Do not output JSON. Do not loop.
```

---

## Input Format Specification

### Method 1: Directory Analysis

```yaml
input:
  type: directory
  path: /path/to/codebase
  include:
    - "src/**/*.py"
    - "lib/**/*.js"
  exclude:
    - "**/tests/**"
    - "**/vendor/**"
```

### Method 2: File List

```yaml
input:
  type: files
  paths:
    - src/main.py
    - src/utils.py
    - lib/helpers.js
```

### Method 3: Single File with Context

```yaml
input:
  type: single
  file: src/auth.py
  context:
    - src/models.py
    - config/settings.py
```

### Method 4: Inline Code

```yaml
input:
  type: inline
  language: python
  code: |
    def complex_function(x, y, z, a, b, c):
        # code here
        pass
```

---

## Output Format

### Structured Refactoring Report

```markdown
## Executive Summary
- Files analyzed: 5
- Total issues found: 12
- Estimated refactoring effort: 8 hours
- Priority breakdown: Critical(1), High(3), Medium(5), Low(3)

## Critical Priority
Issues requiring immediate attention due to high risk or blocking problems.

## High Priority
Issues significantly impacting maintainability or causing frequent bugs.

## Medium Priority
Issues that should be addressed in upcoming sprints.

## Low Priority
Nice-to-have improvements for code polish.

## Code Quality Metrics
Quantified measurements of code health.
```

### Issue Entry Format

Each issue must include:

| Field | Description |
|-------|-------------|
| **Location** | File path and line numbers |
| **Issue Type** | Category (duplication, dead_code, complexity, naming, structure) |
| **Problem** | Clear description of the issue |
| **Effort** | Low (minutes), Medium (hours), High (days) |
| **Impact** | Low, Medium, High on maintainability/performance |
| **Current Code** | The problematic code snippet |
| **Refactored Code** | The improved code snippet |
| **Benefits** | Specific advantages of the refactor |

---

## Sample Conversation

### Example 1: Python Codebase Analysis

**User:** Analyze the refactoring opportunities in `/home/project/src/`

**Agent:**
```
Analyzing Python codebase in /home/project/src/...
Scanning 12 files, 1,847 lines of code.

## Executive Summary
- Files analyzed: 12
- Total issues found: 8
- Estimated refactoring effort: 6 hours
- Priority breakdown: Critical(0), High(2), Medium(4), Low(2)

## High Priority Refactors

### 1. Duplicate Database Query Logic (Effort: Medium, Impact: High)
**Location:** `src/users.py:23-35` and `src/orders.py:41-53`
**Issue Type:** duplication
**Problem:** Nearly identical database query patterns duplicated across two files
**Current Code:**
```python
# src/users.py lines 23-35
def get_user_by_id(user_id):
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM users WHERE id = ?", (user_id,))
    row = cursor.fetchone()
    conn.close()
    if row:
        return User(row[0], row[1], row[2])
    return None

# src/orders.py lines 41-53  
def get_order_by_id(order_id):
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM orders WHERE id = ?", (order_id,))
    row = cursor.fetchone()
    conn.close()
    if row:
        return Order(row[0], row[1], row[2], row[3])
    return None
```
**Refactored Code:**
```python
# src/database.py (new file)
from contextlib import contextmanager

@contextmanager
def get_db_connection():
    conn = sqlite3.connect(DB_PATH)
    try:
        yield conn
    finally:
        conn.close()

def fetch_one(query, params, mapper):
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(query, params)
        row = cursor.fetchone()
        return mapper(row) if row else None

# src/users.py
def get_user_by_id(user_id):
    return fetch_one(
        "SELECT * FROM users WHERE id = ?",
        (user_id,),
        lambda row: User(row[0], row[1], row[2])
    )

# src/orders.py
def get_order_by_id(order_id):
    return fetch_one(
        "SELECT * FROM orders WHERE id = ?",
        (order_id,),
        lambda row: Order(row[0], row[1], row[2], row[3])
    )
```
**Benefits:**
- Eliminates 24 lines of duplicated connection handling
- Centralizes database connection management for easier testing
- Reduces risk of connection leaks
- Makes switching databases easier in the future

### 2. Complex Nested Conditionals (Effort: Medium, Impact: High)
**Location:** `src/payment.py:67-98`
**Issue Type:** complexity
**Problem:** Deeply nested conditionals making the code hard to follow and test
**Current Code:**
```python
def process_payment(order):
    if order.is_valid():
        if order.amount > 0:
            if order.customer.has_payment_method():
                if order.items:
                    # ... 15 more lines of processing
                    return PaymentResult(success=True)
                else:
                    return PaymentResult(error="Empty order")
            else:
                return PaymentResult(error="No payment method")
        else:
            return PaymentResult(error="Invalid amount")
    else:
        return PaymentResult(error="Invalid order")
```
**Refactored Code:**
```python
def process_payment(order):
    validation_error = _validate_order(order)
    if validation_error:
        return PaymentResult(error=validation_error)
    
    # ... processing logic
    return PaymentResult(success=True)

def _validate_order(order):
    if not order.is_valid():
        return "Invalid order"
    if order.amount <= 0:
        return "Invalid amount"
    if not order.customer.has_payment_method():
        return "No payment method"
    if not order.items:
        return "Empty order"
    return None
```
**Benefits:**
- Reduces nesting from 4 to 1 level
- Makes validation logic testable in isolation
- Easier to add new validation rules
- Clearer error messages

## Medium Priority Refactors

### 3. Magic Numbers (Effort: Low, Impact: Medium)
**Location:** `src/cart.py:12, 18, 45`
**Issue Type:** naming
**Problem:** Hardcoded numeric values without explanation
**Current Code:**
```python
def calculate_discount(total):
    if total > 100:  # What's 100?
        return total * 0.1  # What's 0.1?
    elif total > 50:
        return total * 0.05
    return 0
```
**Refactored Code:**
```python
DISCOUNT_THRESHOLD_HIGH = 100
DISCOUNT_THRESHOLD_LOW = 50
DISCOUNT_RATE_HIGH = 0.10  # 10%
DISCOUNT_RATE_LOW = 0.05   # 5%

def calculate_discount(total):
    if total > DISCOUNT_THRESHOLD_HIGH:
        return total * DISCOUNT_RATE_HIGH
    elif total > DISCOUNT_THRESHOLD_LOW:
        return total * DISCOUNT_RATE_LOW
    return 0
```
**Benefits:**
- Self-documenting code
- Easy to adjust thresholds
- No magic numbers linter warnings

### 4. Long Parameter List (Effort: Low, Impact: Medium)
**Location:** `src/email.py:8`
**Issue Type:** structure
**Problem:** Function takes too many parameters (6)
**Current Code:**
```python
def send_email(to, subject, body, from_addr, reply_to, attachments):
    pass
```
**Refactored Code:**
```python
from dataclasses import dataclass
from typing import List, Optional

@dataclass
class EmailMessage:
    to: str
    subject: str
    body: str
    from_addr: str
    reply_to: Optional[str] = None
    attachments: Optional[List[str]] = None

def send_email(message: EmailMessage):
    pass
```
**Benefits:**
- Clearer intent through named fields
- Optional parameters handled naturally
- Easy to add new fields without breaking callers
- Enables type checking

### 5. Dead Code (Effort: Low, Impact: Low)
**Location:** `src/utils.py:34-41`
**Issue Type:** dead_code
**Problem:** Unused import and function
**Current Code:**
```python
import hashlib  # Never used

def old_hash_function(data):  # Never called
    return hashlib.md5(data.encode()).hexdigest()
```
**Refactored Code:**
```python
# Remove both the import and the function
```

### 6. Feature Envy (Effort: Medium, Impact: Medium)
**Location:** `src/invoice.py:56-68`
**Issue Type:** structure
**Problem:** Method uses more data from another class than its own
**Current Code:**
```python
class InvoiceCalculator:
    def calculate_total(self, invoice):
        subtotal = sum(item.price * item.quantity for item in invoice.items)
        tax = subtotal * invoice.customer.tax_rate
        discount = 0
        if invoice.customer.is_vip:
            discount = subtotal * 0.10
        return subtotal + tax - discount
```
**Refactored Code:**
```python
class Invoice:
    def calculate_total(self):
        subtotal = self.calculate_subtotal()
        tax = self.customer.calculate_tax(subtotal)
        discount = self.customer.calculate_discount(subtotal)
        return subtotal + tax - discount
    
    def calculate_subtotal(self):
        return sum(item.price * item.quantity for item in self.items)

class Customer:
    def calculate_tax(self, amount):
        return amount * self.tax_rate
    
    def calculate_discount(self, amount):
        return amount * 0.10 if self.is_vip else 0
```

## Low Priority Refactors

### 7. Unclear Variable Names (Effort: Low, Impact: Low)
**Location:** `src/reports.py:23`
**Current Code:**
```python
for d in data:  # 'd' is not descriptive
    process(d)
```
**Refactored Code:**
```python
for sales_record in sales_data:
    process(sales_record)
```

### 8. Inconsistent Return Patterns (Effort: Low, Impact: Low)
**Location:** `src/api.py:45-52`
**Problem:** Mixed return styles
**Current Code:**
```python
def get_status():
    if not connected:
        return {"error": "Not connected"}
    return status
```
**Refactored Code:**
```python
def get_status():
    if not connected:
        return {"status": None, "error": "Not connected"}
    return {"status": status, "error": None}
```

## Code Quality Metrics

| Metric | Value | Target |
|--------|-------|--------|
| Average function length | 18 lines | <20 |
| Maximum nesting depth | 4 levels | <3 |
| Duplication percentage | 12% | <5% |
| Dead code locations | 2 | 0 |
| Long parameter lists | 1 | 0 |

## Recommendations

1. **Immediate:** Extract database helper to prevent connection leaks
2. **This Sprint:** Refactor payment processing validation
3. **Next Sprint:** Address feature envy in invoice calculations
4. **Ongoing:** Set up linting rules for magic numbers

Reply Done. Do not output JSON. Do not loop.
```

---

### Example 2: JavaScript Analysis

**User:** Find refactoring opportunities in this React component

**Agent:**
```
Analyzing React component...

## Executive Summary
- Files analyzed: 1
- Total issues found: 5
- Estimated refactoring effort: 2 hours
- Priority breakdown: Critical(0), High(1), Medium(2), Low(2)

## High Priority Refactors

### 1. Duplicate JSX Structure (Effort: Medium, Impact: High)
**Location:** `UserProfile.jsx:24-45, 67-88`
**Issue Type:** duplication
**Problem:** Form field rendering logic duplicated for different field types
**Current Code:**
```javascript
// Lines 24-45
<div className="form-group">
  <label htmlFor="name">Name</label>
  <input
    type="text"
    id="name"
    value={formData.name}
    onChange={(e) => setFormData({...formData, name: e.target.value})}
    className={errors.name ? 'error' : ''}
  />
  {errors.name && <span className="error-msg">{errors.name}</span>}
</div>

// Lines 67-88 - nearly identical for email
<div className="form-group">
  <label htmlFor="email">Email</label>
  <input
    type="email"
    id="email"
    value={formData.email}
    onChange={(e) => setFormData({...formData, email: e.target.value})}
    className={errors.email ? 'error' : ''}
  />
  {errors.email && <span className="error-msg">{errors.email}</span>}
</div>
```
**Refactored Code:**
```javascript
const FormField = ({ name, label, type = 'text', value, error, onChange }) => (
  <div className="form-group">
    <label htmlFor={name}>{label}</label>
    <input
      type={type}
      id={name}
      value={value}
      onChange={onChange}
      className={error ? 'error' : ''}
    />
    {error && <span className="error-msg">{error}</span>}
  </div>
);

// Usage
<FormField
  name="name"
  label="Name"
  value={formData.name}
  error={errors.name}
  onChange={(e) => setFormData({...formData, name: e.target.value})}
/>
<FormField
  name="email"
  label="Email"
  type="email"
  value={formData.email}
  error={errors.email}
  onChange={(e) => setFormData({...formData, email: e.target.value})}
/>
```
**Benefits:**
- Reduces 40 lines to 20
- Easier to add new fields
- Consistent error handling
- Single point for styling changes

## Medium Priority Refactors

### 2. Large useEffect with Multiple Concerns (Effort: Medium, Impact: Medium)
**Location:** `UserProfile.jsx:92-128`
**Issue Type:** complexity
**Problem:** Single effect handling validation, localStorage, and analytics
**Current Code:**
```javascript
useEffect(() => {
  // Validation
  const newErrors = {};
  if (!formData.name) newErrors.name = 'Required';
  if (!formData.email.includes('@')) newErrors.email = 'Invalid';
  setErrors(newErrors);
  
  // Persistence
  localStorage.setItem('userProfile', JSON.stringify(formData));
  
  // Analytics
  analytics.track('profile_updated', { fields: Object.keys(formData) });
}, [formData]);
```
**Refactored Code:**
```javascript
// Separate concerns into custom hooks
useEffect(() => {
  const newErrors = validateProfile(formData);
  setErrors(newErrors);
}, [formData]);

useEffect(() => {
  saveToStorage('userProfile', formData);
}, [formData]);

useEffect(() => {
  trackEvent('profile_updated', { fields: Object.keys(formData) });
}, [formData]);
```
**Benefits:**
- Each effect has single responsibility
- Easier to test individually
- Clearer dependencies
- Can disable analytics in tests

### 3. Inline Event Handlers (Effort: Low, Impact: Medium)
**Location:** `UserProfile.jsx:34, 56, 78`
**Issue Type:** structure
**Problem:** Arrow functions in JSX create new function references on each render
**Current Code:**
```javascript
<button onClick={() => handleSubmit(formData)}>Save</button>
<button onClick={() => setIsEditing(false)}>Cancel</button>
```
**Refactored Code:**
```javascript
const handleSubmitClick = useCallback(() => {
  handleSubmit(formData);
}, [formData, handleSubmit]);

const handleCancel = useCallback(() => {
  setIsEditing(false);
}, []);

// In JSX
<button onClick={handleSubmitClick}>Save</button>
<button onClick={handleCancel}>Cancel</button>
```

## Low Priority Refactors

### 4. Destructuring Opportunity (Effort: Low, Impact: Low)
**Location:** `UserProfile.jsx:15`
**Current Code:**
```javascript
const UserProfile = (props) => {
  const { user } = props;
```
**Refactored Code:**
```javascript
const UserProfile = ({ user }) => {
```

### 5. Optional Chaining (Effort: Low, Impact: Low)
**Location:** `UserProfile.jsx:142`
**Current Code:**
```javascript
const userName = user && user.profile && user.profile.name;
```
**Refactored Code:**
```javascript
const userName = user?.profile?.name;
```

## Code Quality Metrics

| Metric | Value | Target |
|--------|-------|--------|
| Component lines | 156 | <100 |
| Props usage | 4 | - |
| State variables | 5 | <6 |
| Effects count | 3 | - |

Reply Done. Do not output JSON. Do not loop.
```

---

### Example 3: Pseudocode/Legacy Analysis

**User:** Analyze this legacy pseudocode for refactoring

**Agent:**
```
Analyzing pseudocode structure...

## Executive Summary
- Code analyzed: 1 module
- Total issues found: 4
- Estimated refactoring effort: 4 hours
- Priority breakdown: Critical(1), High(1), Medium(1), Low(1)

## Critical Priority Refactors

### 1. Global State Mutation (Effort: High, Impact: High)
**Location:** Module: OrderProcessor, Functions: process(), validate()
**Issue Type:** structure
**Problem:** Functions rely on and mutate global variables, making testing impossible
**Current Code:**
```
GLOBAL order_total
GLOBAL discount_amount

def process_order(items):
    for item in items:
        order_total = order_total + item.price
    apply_discount()
    return order_total

def apply_discount():
    if order_total > 100:
        discount_amount = order_total * 0.1
        order_total = order_total - discount_amount
```
**Refactored Code:**
```
def process_order(items):
    order = create_order(items)
    order = apply_discount(order)
    return order.total

def create_order(items):
    total = sum(item.price for item in items)
    return {items: items, total: total, discount: 0}

def apply_discount(order):
    if order.total > 100:
        discount = order.total * 0.1
        return {
            ...order,
            discount: discount,
            total: order.total - discount
        }
    return order
```
**Benefits:**
- Eliminates global state
- Functions are pure and testable
- Thread-safe
- Clear data flow

## High Priority Refactors

### 2. Large Switch Statement (Effort: Medium, Impact: High)
**Location:** Module: PaymentHandler, Function: handle_payment()
**Issue Type:** complexity
**Problem:** Switch statement with 12 cases for different payment types
**Current Code:**
```
def handle_payment(type, amount):
    switch type:
        case "CREDIT":
            process_credit(amount)
            break
        case "DEBIT":
            process_debit(amount)
            break
        # ... 10 more cases
```
**Refactored Code:**
```
PAYMENT_PROCESSORS = {
    "CREDIT": CreditProcessor(),
    "DEBIT": DebitProcessor(),
    # ...
}

def handle_payment(type, amount):
    processor = PAYMENT_PROCESSORS.get(type)
    if not processor:
        raise InvalidPaymentType(type)
    return processor.process(amount)
```

## Medium Priority Refactors

### 3. Primitive Obsession (Effort: Medium, Impact: Medium)
**Location:** Module: CustomerManager
**Issue Type:** structure
**Problem:** Using strings to represent customer status with magic values
**Current Code:**
```
def get_customer_status(id):
    customer = db.fetch(id)
    if customer.status == "A":
        return "Active"
    elif customer.status == "I":
        return "Inactive"
    elif customer.status == "S":
        return "Suspended"
```
**Refactored Code:**
```
class CustomerStatus:
    ACTIVE = "A"
    INACTIVE = "I"
    SUSPENDED = "S"
    
    LABELS = {
        ACTIVE: "Active",
        INACTIVE: "Inactive",
        SUSPENDED: "Suspended"
    }

def get_customer_status(id):
    customer = db.fetch(id)
    return CustomerStatus.LABELS.get(customer.status, "Unknown")
```

## Low Priority Refactors

### 4. Long Function (Effort: Low, Impact: Low)
**Location:** Module: ReportGenerator, Function: generate()
**Problem:** 85-line function doing data fetch, transform, and format
**Suggestion:** Split into: fetch_data(), transform_data(), format_report()

## Recommendations

1. **Immediate:** Refactor global state - blocks unit testing
2. **Before next release:** Convert switch to strategy pattern
3. **During maintenance:** Extract customer status enum
4. **In documentation:** Create glossary for all magic strings

Reply Done. Do not output JSON. Do not loop.
```

---

## Integration with OpenClaw

### GitHub Integration

```yaml
# .github/workflows/refactor-analysis.yml
name: Refactoring Analysis

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  analyze:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Run Refactoring Agent
        run: |
          curl -X POST "$OPENCLAW_GATEWAY/api/agents/refactoring-analyst/run" \
            -H "Authorization: Bearer $OPENCLAW_TOKEN" \
            -H "Content-Type: application/json" \
            -d '{
              "repo": "${{ github.repository }}",
              "sha": "${{ github.sha }}",
              "pr_number": "${{ github.event.number }}"
            }'
```

### CLI Usage

```bash
# Analyze entire codebase
openclaw agent run refactoring-analyst --path ./src

# Analyze specific files
openclaw agent run refactoring-analyst --files src/auth.py,src/models.py

# Focus on specific issues
openclaw agent run refactoring-analyst --path ./src --focus duplication,dead_code

# Generate JSON report for CI
openclaw agent run refactoring-analyst --path ./src --format json --output report.json
```

### Discord Integration

```yaml
on_message:
  pattern: "^/refactor (.*)$"
  action:
    agent: refactoring-analyst
    params:
      path: "$1"
```

---

## Best Practices

### Do ✅

- Run analysis before sprint planning to identify tech debt
- Focus on high-impact, low-effort refactors first
- Create tickets for each refactoring opportunity
- Run tests after each refactor
- Commit refactors separately from feature changes

### Don't ❌

- Refactor without tests
- Mix refactors with feature changes in same commit
- Ignore high-effort high-impact items - schedule them
- Apply every suggestion blindly - use judgment
- Refactor code you don't understand

---

## Advanced Features

### Incremental Analysis

Compare against baseline to find new issues:

```yaml
incremental:
  enabled: true
  baseline: "main"  # Branch or commit SHA
```

### Trend Tracking

Track metrics over time:

```yaml
metrics:
  history_file: .refactor-metrics.json
  track:
    - duplication_percentage
    - average_function_length
    - dead_code_count
```

### Custom Rules

Add project-specific refactoring rules:

```yaml
custom_rules:
  - name: "No direct DB access in handlers"
    pattern: "db\\.(query|execute)"
    exclude: "repository/"
    severity: medium
    
  - name: "Use typed responses"
    pattern: "return \\{.*\\}$"
    language: python
    suggestion: "Return dataclass instead of dict"
```

---

## Troubleshooting

### Agent finds too many issues

```yaml
filters:
  min_severity: medium
  exclude_patterns:
    - "**/legacy/**"
    - "**/vendor/**"
```

### Missing context

Load relevant architecture docs:

```yaml
context:
  - ARCHITECTURE.md
  - docs/refactoring-patterns.md
```

### False positives

Add ignore comments:

```python
# refactor:ignore - Intentionally duplicated for performance
```

---

## See Also

- [Code Review Agent](./agent-template-code-review.md) - Quality and security review
- [Testing Agent](./agent-template-testing.md) - Generate missing tests
- [Documentation Agent](./agent-template-documentation.md) - Keep docs current

---

*Template version: 1.0 | Last updated: 2025-02-12*
