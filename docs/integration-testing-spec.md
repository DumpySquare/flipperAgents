# MCP Server Integration Testing Specification

**Status:** 📋 Spec Complete  
**Scope:** TMOS MCP Server (primary), NetScaler MCP Server (future)  
**Parent Doc:** [future-mcp-servers.md](./future-mcp-servers.md)
**Updated:** 2025-12-30 (added extended test matrix)

---

## Summary

Integration testing strategy using f5-corkscrew's curated test configurations as regression fixtures. Configs are extracted from corkscrew's test qkview, deployed to a lab BIG-IP, then verified through the TMOS MCP server tools.

**Key Value:** Real-world configs exercising edge cases, maintained as corkscrew evolves.

---

## Table of Contents

| Section | Description |
|---------|-------------|
| [1. Overview](#1-overview) | Testing strategy and goals |
| [2. Test Fixture Source](#2-test-fixture-source) | Corkscrew test qkview |
| [3. Test Architecture](#3-test-architecture) | How tests flow |
| [4. Test Categories](#4-test-categories) | Types of tests to run |
| [5. Lab Environment](#5-lab-environment) | BIG-IP test device setup |
| [6. Implementation](#6-implementation) | Scripts and automation |
| [7. CI/CD Integration](#7-cicd-integration) | Automated test runs |

---

## 1. Overview

### 1.1 Testing Goals

| Goal | Description |
|------|-------------|
| **Regression coverage** | Catch breaking changes before release |
| **Real-world configs** | Test against production-like configurations |
| **Edge case coverage** | Corkscrew's test data includes complex scenarios |
| **Round-trip validation** | Extract → Deploy → Verify cycle |
| **Tool verification** | Ensure all MCP tools work correctly |

### 1.2 Testing Layers

```
┌─────────────────────────────────────────────────────────────┐
│                     Test Layers                              │
├─────────────────────────────────────────────────────────────┤
│  Unit Tests          │ Individual tool logic (mocked device) │
├─────────────────────────────────────────────────────────────┤
│  Integration Tests   │ Tools against real BIG-IP (this spec) │
├─────────────────────────────────────────────────────────────┤
│  End-to-End Tests    │ Full workflows via Claude MCP client  │
└─────────────────────────────────────────────────────────────┘
```

This spec focuses on **Integration Tests** — real MCP tools against a real BIG-IP with realistic configurations.

---

## 2. Test Fixture Source

### 2.1 Corkscrew Test QKView

The f5-corkscrew project maintains a test qkview containing curated configurations:

```
Upstream: https://github.com/f5devcentral/f5-corkscrew/releases/latest/download/corkscrewTestData.qkview
Local:    tests/fixtures/corkscrewTestData.qkview (committed to repo)
```

This qkview is:
- **Generated automatically** when corkscrew is updated
- **Contains test configs** covering LTM, GTM, APM, ASM scenarios
- **Used by vscode-f5** as example data for Config Explorer
- **Maintained alongside corkscrew** — stays current with parser capabilities

### 2.2 Fixture Storage Strategy

**Approach:** Commit to repo, refresh periodically

```
tests/
└── fixtures/
    ├── corkscrewTestData.qkview    # Committed to repo
    └── .qkview-version             # Tracks source version
```

**Rationale:**

| Consideration | Decision |
|---------------|----------|
| Test reliability | No network dependency — tests always work |
| CI speed | No download step — faster test runs |
| Offline development | Works without internet |
| Version control | Explicit control over when fixtures update |
| Staleness risk | Mitigated by refresh script + nightly check |

**Version tracking file (`.qkview-version`):**

```json
{
  "source": "https://github.com/f5devcentral/f5-corkscrew/releases/download/v1.4.1/corkscrewTestData.qkview",
  "version": "1.4.1",
  "downloaded_at": "2024-01-15T10:00:00Z",
  "sha256": "abc123..."
}
```

### 2.3 Fixture Management Scripts

#### Check Script

```bash
#!/bin/bash
# scripts/check-fixture-version.sh

set -e

VERSION_FILE="tests/fixtures/.qkview-version"

# Get latest release version from GitHub API
LATEST_VERSION=$(curl -s https://api.github.com/repos/f5devcentral/f5-corkscrew/releases/latest | jq -r .tag_name)

# Check current version
if [ -f "$VERSION_FILE" ]; then
  CURRENT_VERSION=$(jq -r .version "$VERSION_FILE")
  DOWNLOADED_AT=$(jq -r .downloaded_at "$VERSION_FILE")
else
  CURRENT_VERSION="not installed"
  DOWNLOADED_AT="never"
fi

echo "Current fixture version: $CURRENT_VERSION"
echo "Downloaded at:          $DOWNLOADED_AT"
echo "Latest corkscrew:       $LATEST_VERSION"
echo ""

if [ "$CURRENT_VERSION" = "$LATEST_VERSION" ]; then
  echo "✅ Fixtures are up to date."
  exit 0
else
  echo "⚠️  Update available. Run 'npm run test:fixtures:refresh' to update."
  exit 0  # Don't fail, just inform
fi
```

#### Refresh Script

Script to download and update fixtures:

```bash
#!/bin/bash
# scripts/refresh-test-fixtures.sh

set -e

FIXTURE_DIR="tests/fixtures"
QKVIEW_FILE="$FIXTURE_DIR/corkscrewTestData.qkview"
VERSION_FILE="$FIXTURE_DIR/.qkview-version"
UPSTREAM_URL="https://github.com/f5devcentral/f5-corkscrew/releases/latest/download/corkscrewTestData.qkview"

# Get latest release version from GitHub API
LATEST_VERSION=$(curl -s https://api.github.com/repos/f5devcentral/f5-corkscrew/releases/latest | jq -r .tag_name)

# Check current version
if [ -f "$VERSION_FILE" ]; then
  CURRENT_VERSION=$(jq -r .version "$VERSION_FILE")
else
  CURRENT_VERSION="none"
fi

echo "Current version: $CURRENT_VERSION"
echo "Latest version:  $LATEST_VERSION"

if [ "$CURRENT_VERSION" = "$LATEST_VERSION" ]; then
  echo "Already up to date."
  exit 0
fi

echo "Downloading new version..."
mkdir -p "$FIXTURE_DIR"
curl -L -o "$QKVIEW_FILE" "$UPSTREAM_URL"

# Calculate SHA256
SHA256=$(sha256sum "$QKVIEW_FILE" | cut -d' ' -f1)

# Update version file
cat > "$VERSION_FILE" << EOF
{
  "source": "https://github.com/f5devcentral/f5-corkscrew/releases/download/$LATEST_VERSION/corkscrewTestData.qkview",
  "version": "$LATEST_VERSION",
  "downloaded_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "sha256": "$SHA256"
}
EOF

echo "Updated to $LATEST_VERSION"
echo "Don't forget to commit the changes!"
```

### 2.4 What's Inside

The test qkview includes configurations for:

| Category | Examples |
|----------|----------|
| **LTM Virtuals** | HTTP, HTTPS, TCP, UDP, forwarding VIPs |
| **Pools** | Various LB methods, monitors, priority groups |
| **Profiles** | HTTP, TCP, SSL client/server, persistence |
| **iRules** | Redirects, header manipulation, data groups |
| **Policies** | Local traffic policies with various actions |
| **GTM/DNS** | Wide IPs, pools, data centers |
| **APM** | Access policies (profiles attached to VIPs) |
| **ASM/WAF** | Security policies |
| **Certificates** | SSL certs and keys |

### 2.5 Extracting Configs

Use corkscrew to extract configurations from the qkview:

```bash
# Install corkscrew
npm install -g f5-corkscrew

# Download test qkview
curl -L -o test.qkview \
  https://github.com/f5devcentral/f5-corkscrew/releases/latest/download/corkscrewTestData.qkview

# Extract to JSON
corkscrew --file test.qkview > extracted.json

# Or with XML stats
corkscrew --file test.qkview --includeXmlStats > extracted.json
```

Output structure:
```json
{
  "output": {
    "config": {
      "apps": [
        {
          "name": "/Common/app1_vs",
          "config": "ltm virtual /Common/app1_vs { ... }",
          "map": {
            "name": "/Common/app1_vs",
            "destination": "192.168.1.10:443",
            "pool": "/Common/app1_pool"
          }
        }
      ]
    },
    "stats": {
      "objectCount": 153,
      "objects": {
        "virtuals": 7,
        "pools": 7,
        "nodes": 10,
        "monitors": 6
      }
    }
  }
}
```

---

## 3. Test Architecture

### 3.1 Test Flow

```
┌──────────────────┐     ┌──────────────────┐     ┌──────────────────┐
│   Corkscrew      │     │   Test Runner    │     │   Lab BIG-IP     │
│   Test QKView    │────▶│                  │────▶│                  │
│                  │     │  1. Download     │     │  4. Deploy       │
└──────────────────┘     │  2. Extract      │     │  5. Verify       │
                         │  3. Transform    │     │  6. Cleanup      │
                         └──────────────────┘     └──────────────────┘
                                  │
                                  ▼
                         ┌──────────────────┐
                         │   TMOS MCP       │
                         │   Server         │
                         │                  │
                         │  - Deploy tools  │
                         │  - Verify tools  │
                         │  - Cleanup tools │
                         └──────────────────┘
```

### 3.2 Test Phases

| Phase | Description | Tools Used |
|-------|-------------|------------|
| **Setup** | Download qkview, extract configs, prepare lab | corkscrew, curl |
| **Deploy** | Create objects on lab BIG-IP | MCP create/update tools |
| **Verify** | Read back and compare | MCP get/list tools |
| **Exercise** | Run various operations | MCP tools |
| **Cleanup** | Remove test objects | MCP delete tools |

### 3.3 Test Isolation

Each test run should:
1. Use a dedicated partition (e.g., `/test_<timestamp>`)
2. Create all objects in that partition
3. Clean up partition after tests
4. Not affect existing lab configuration

```typescript
// Test partition naming
const testPartition = `test_${Date.now()}`;

// All test objects go here
const testVirtual = `/${testPartition}/vs_test_app`;
const testPool = `/${testPartition}/pool_test_app`;
```

---

## 4. Test Categories

### 4.1 CRUD Operations

Basic create/read/update/delete for each object type:

| Object Type | Create | Read | Update | Delete |
|-------------|--------|------|--------|--------|
| Virtual Server | ✓ | ✓ | ✓ | ✓ |
| Pool | ✓ | ✓ | ✓ | ✓ |
| Pool Member | ✓ | ✓ | ✓ | ✓ |
| Node | ✓ | ✓ | ✓ | ✓ |
| Monitor | ✓ | ✓ | ✓ | ✓ |
| Profile (various) | ✓ | ✓ | ✓ | ✓ |
| iRule | ✓ | ✓ | ✓ | ✓ |
| Policy | ✓ | ✓ | ✓ | ✓ |
| Certificate | ✓ | ✓ | ✓ | ✓ |
| Data Group | ✓ | ✓ | ✓ | ✓ |

### 4.2 Dependency Tests

Verify objects with dependencies are handled correctly:

| Test | Description |
|------|-------------|
| Virtual + Pool | Create pool first, then virtual referencing it |
| Pool + Members | Create nodes, then pool with members |
| Virtual + Profiles | Create profiles, attach to virtual |
| Virtual + iRules | Create iRules, attach to virtual |
| Delete cascade | Delete virtual, verify pool remains |
| Delete blocked | Try to delete pool still in use |

### 4.3 Round-Trip Tests

Deploy config from corkscrew, read back, compare:

```typescript
interface RoundTripTest {
  name: string;
  sourceConfig: string;       // From corkscrew extraction
  deployedConfig: string;     // Read back from device
  differences: string[];      // Acceptable differences (ordering, defaults)
}
```

Expected acceptable differences:
- Property ordering
- Default values explicitly shown
- Object reference formats
- Timestamp fields

### 4.4 Edge Case Tests

Specific scenarios from corkscrew test data:

| Test | Description |
|------|-------------|
| Special characters | Partition/object names with `.`, `-`, `_` |
| Long names | Maximum length object names |
| Unicode | Description fields with unicode |
| Empty pools | Pools with no members |
| Disabled objects | Disabled virtuals, pools, members |
| Large configs | Many objects, large iRules |
| Complex iRules | Multi-line, includes, events |
| Policy conditions | Various match conditions and actions |

### 4.5 AS3 Integration Tests

If AS3 is installed on lab device:

| Test | Description |
|------|-------------|
| Deploy tenant | Deploy AS3 declaration |
| Verify tenant | Read back via MCP tools |
| Drift detection | Modify via GUI, detect drift |
| Patch generation | Generate AS3 patch |
| Dry-run validation | Test patch without applying |

### 4.6 Error Handling Tests

Verify graceful handling of errors:

| Test | Expected Behavior |
|------|-------------------|
| Invalid pool reference | Clear error: "Pool 'x' not found" |
| Duplicate name | Clear error: "Object already exists" |
| Invalid IP format | Validation error before API call |
| Auth failure | Clear error, suggest fix |
| Network timeout | Retry logic, eventual failure |
| Partial failure | Report what succeeded/failed |

---

## 5. Lab Environment

### 5.1 Requirements

| Component | Requirement |
|-----------|-------------|
| BIG-IP Version | 15.1+ (ideally 16.1+ for full AS3 support) |
| Licensing | LTM required, ASM/APM optional |
| Network | Reachable from test runner |
| Credentials | Admin user for API access |
| AS3 | Installed for AS3 tests |

### 5.2 Lab Configuration

```bash
# Environment variables for test runner
BIGIP_TEST_HOST=10.1.1.100
BIGIP_TEST_USER=admin
BIGIP_TEST_PASS=<password>
BIGIP_TEST_PARTITION=test_mcp
BIGIP_VERIFY_SSL=false
```

### 5.3 Lab Setup Script

```bash
#!/bin/bash
# setup-test-lab.sh

# Create test partition
curl -sk -u admin:$BIGIP_TEST_PASS \
  -H "Content-Type: application/json" \
  -X POST \
  "https://$BIGIP_TEST_HOST/mgmt/tm/auth/partition" \
  -d '{"name": "test_mcp"}'

# Verify AS3 is installed
curl -sk -u admin:$BIGIP_TEST_PASS \
  "https://$BIGIP_TEST_HOST/mgmt/shared/appsvcs/info"
```

### 5.4 Lab Cleanup Script

```bash
#!/bin/bash
# cleanup-test-lab.sh

# Delete test partition (and all objects in it)
curl -sk -u admin:$BIGIP_TEST_PASS \
  -X DELETE \
  "https://$BIGIP_TEST_HOST/mgmt/tm/auth/partition/test_mcp"
```

---

## 6. Implementation

### 6.1 Test Runner Structure

```
tests/
├── fixtures/
│   ├── corkscrewTestData.qkview  # Committed to repo
│   └── .qkview-version           # Version tracking
├── integration/
│   ├── setup.ts              # Extract fixtures, prepare lab
│   ├── teardown.ts           # Cleanup after tests
│   ├── fixtures/
│   │   ├── loader.ts         # Load local qkview fixture
│   │   ├── extract.ts        # Extract configs via corkscrew
│   │   └── transform.ts      # Transform to test cases
│   ├── crud/
│   │   ├── virtual.test.ts   # Virtual server CRUD
│   │   ├── pool.test.ts      # Pool CRUD
│   │   ├── member.test.ts    # Pool member CRUD
│   │   ├── monitor.test.ts   # Monitor CRUD
│   │   ├── profile.test.ts   # Profile CRUD
│   │   └── irule.test.ts     # iRule CRUD
│   ├── dependencies/
│   │   ├── ordering.test.ts  # Dependency ordering
│   │   └── cascade.test.ts   # Delete behavior
│   ├── roundtrip/
│   │   ├── apps.test.ts      # Full app round-trip
│   │   └── compare.ts        # Config comparison utilities
│   ├── edge-cases/
│   │   ├── names.test.ts     # Special character handling
│   │   └── large.test.ts     # Large config handling
│   ├── as3/
│   │   ├── deploy.test.ts    # AS3 deployment
│   │   └── drift.test.ts     # Drift detection
│   └── errors/
│       └── handling.test.ts  # Error scenarios
└── helpers/
    ├── mcp-client.ts         # MCP server client for tests
    ├── bigip-client.ts       # Direct iControl REST for verification
    └── assertions.ts         # Custom test assertions
```

### 6.2 Fixture Loader

```typescript
// tests/integration/fixtures/loader.ts

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

const FIXTURES_DIR = join(__dirname, '../../../fixtures');
const QKVIEW_PATH = join(FIXTURES_DIR, 'corkscrewTestData.qkview');
const VERSION_PATH = join(FIXTURES_DIR, '.qkview-version');

export interface FixtureInfo {
  path: string;
  version: string;
  source: string;
  downloadedAt: string;
}

export function getTestQkviewPath(): string {
  if (!existsSync(QKVIEW_PATH)) {
    throw new Error(
      `Test fixture not found: ${QKVIEW_PATH}\n` +
      `Run 'npm run test:fixtures:refresh' to download.`
    );
  }
  return QKVIEW_PATH;
}

export function getFixtureInfo(): FixtureInfo {
  const qkviewPath = getTestQkviewPath();
  
  if (!existsSync(VERSION_PATH)) {
    return {
      path: qkviewPath,
      version: 'unknown',
      source: 'unknown',
      downloadedAt: 'unknown',
    };
  }
  
  const versionData = JSON.parse(readFileSync(VERSION_PATH, 'utf-8'));
  return {
    path: qkviewPath,
    version: versionData.version,
    source: versionData.source,
    downloadedAt: versionData.downloaded_at,
  };
}
```

### 6.3 Config Extraction

```typescript
// tests/integration/fixtures/extract.ts

import BigipConfig from 'f5-corkscrew';

export interface ExtractedApp {
  name: string;
  config: string;
  map: {
    destination?: string;
    pool?: string;
    profiles?: string[];
    rules?: string[];
  };
}

export async function extractApps(qkviewPath: string): Promise<ExtractedApp[]> {
  const bigip = new BigipConfig();
  await bigip.loadParseAsync(qkviewPath);
  const explosion = await bigip.explode();
  
  return explosion.config.apps;
}

export async function extractObjects(qkviewPath: string): Promise<Record<string, any[]>> {
  const bigip = new BigipConfig();
  await bigip.loadParseAsync(qkviewPath);
  
  // Get parsed object tree
  return bigip.configObject;
}
```

### 6.4 Test Case Generation

```typescript
// tests/integration/fixtures/transform.ts

import { ExtractedApp } from './extract';

export interface TestCase {
  name: string;
  description: string;
  objects: TestObject[];
  expectedOutcome: 'success' | 'error';
  errorPattern?: RegExp;
}

export interface TestObject {
  type: 'virtual' | 'pool' | 'monitor' | 'profile' | 'irule' | 'node';
  name: string;
  config: Record<string, any>;
  dependencies: string[];
}

export function appToTestCase(app: ExtractedApp): TestCase {
  // Transform corkscrew app to MCP test case
  const objects: TestObject[] = [];
  
  // Parse virtual server config
  // Parse pool config
  // Parse profiles, iRules, etc.
  
  return {
    name: `test_${app.name.replace(/\//g, '_')}`,
    description: `Round-trip test for ${app.name}`,
    objects,
    expectedOutcome: 'success',
  };
}
```

### 6.5 Example Test

```typescript
// tests/integration/crud/pool.test.ts

import { describe, it, before, after, expect } from 'vitest';
import { McpTestClient } from '../../helpers/mcp-client';
import { extractObjects } from '../fixtures/extract';

describe('Pool CRUD', () => {
  let mcp: McpTestClient;
  let testPools: any[];
  
  before(async () => {
    mcp = new McpTestClient();
    await mcp.connect();
    
    // Extract pool configs from test qkview
    const objects = await extractObjects('./tests/fixtures/corkscrewTestData.qkview');
    testPools = objects.ltm?.pool || [];
  });
  
  after(async () => {
    await mcp.cleanup();
    await mcp.disconnect();
  });
  
  it('should create a pool from corkscrew test data', async () => {
    const sourcePool = testPools[0];
    
    // Create via MCP
    const result = await mcp.call('create_pool', {
      name: `test_${sourcePool.name}`,
      members: sourcePool.members,
      monitor: sourcePool.monitor,
    });
    
    expect(result.success).toBe(true);
    
    // Read back
    const pool = await mcp.call('get_pool', {
      name: `test_${sourcePool.name}`,
    });
    
    expect(pool.members.length).toBe(sourcePool.members.length);
  });
  
  it('should list all test pools', async () => {
    const result = await mcp.call('list_pools', {
      partition: 'test_mcp',
    });
    
    expect(result.pools.length).toBeGreaterThan(0);
  });
  
  it('should update pool members', async () => {
    // ... update test
  });
  
  it('should delete pool', async () => {
    // ... delete test
  });
});
```

### 6.6 Config Comparison Utility

```typescript
// tests/helpers/assertions.ts

export interface ConfigDiff {
  path: string;
  source: any;
  target: any;
  severity: 'error' | 'warning' | 'info';
}

export function compareConfigs(
  source: Record<string, any>,
  target: Record<string, any>,
  ignorePaths: string[] = []
): ConfigDiff[] {
  const diffs: ConfigDiff[] = [];
  
  // Recursive comparison
  // Ignore ordering differences
  // Ignore default value additions
  // Flag actual semantic differences
  
  return diffs;
}

// Acceptable differences that don't indicate failure
const ACCEPTABLE_DIFFS = [
  /\.generation$/,           // Generation numbers change
  /\.lastModified$/,         // Timestamps change
  /\.selfLink$/,             // Self links include server
  /\.kind$/,                 // Kind may be formatted differently
];

export function isAcceptableDiff(diff: ConfigDiff): boolean {
  return ACCEPTABLE_DIFFS.some(pattern => pattern.test(diff.path));
}
```

---

## 7. CI/CD Integration

### 7.1 GitHub Actions Workflow

```yaml
# .github/workflows/integration-tests.yml

name: Integration Tests

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  integration-tests:
    runs-on: ubuntu-latest
    
    # Only run if lab is available
    if: ${{ vars.BIGIP_TEST_HOST != '' }}
    
    steps:
      - uses: actions/checkout@v4
      
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'npm'
      
      - name: Install dependencies
        run: npm ci
      
      - name: Verify test fixtures exist
        run: |
          if [ ! -f tests/fixtures/corkscrewTestData.qkview ]; then
            echo "Error: Test fixtures not found. Run 'npm run test:fixtures:refresh' and commit."
            exit 1
          fi
          cat tests/fixtures/.qkview-version
      
      - name: Run integration tests
        env:
          BIGIP_TEST_HOST: ${{ secrets.BIGIP_TEST_HOST }}
          BIGIP_TEST_USER: ${{ secrets.BIGIP_TEST_USER }}
          BIGIP_TEST_PASS: ${{ secrets.BIGIP_TEST_PASS }}
        run: npm run test:integration
      
      - name: Upload test results
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: test-results
          path: test-results/
```

### 7.1.1 Nightly Fixture Update Check

```yaml
# .github/workflows/check-fixtures.yml

name: Check Fixture Updates

on:
  schedule:
    # Run nightly at 2am UTC
    - cron: '0 2 * * *'
  workflow_dispatch:  # Allow manual trigger

jobs:
  check-fixtures:
    runs-on: ubuntu-latest
    
    steps:
      - uses: actions/checkout@v4
      
      - name: Check for corkscrew updates
        id: check
        run: |
          LATEST=$(curl -s https://api.github.com/repos/f5devcentral/f5-corkscrew/releases/latest | jq -r .tag_name)
          CURRENT=$(jq -r .version tests/fixtures/.qkview-version 2>/dev/null || echo "none")
          
          echo "current=$CURRENT" >> $GITHUB_OUTPUT
          echo "latest=$LATEST" >> $GITHUB_OUTPUT
          
          if [ "$CURRENT" != "$LATEST" ]; then
            echo "update_available=true" >> $GITHUB_OUTPUT
          else
            echo "update_available=false" >> $GITHUB_OUTPUT
          fi
      
      - name: Create issue if update available
        if: steps.check.outputs.update_available == 'true'
        uses: actions/github-script@v7
        with:
          script: |
            const title = `Update test fixtures to corkscrew ${{ steps.check.outputs.latest }}`;
            const body = `A new version of f5-corkscrew is available.
            
            **Current:** ${{ steps.check.outputs.current }}
            **Latest:** ${{ steps.check.outputs.latest }}
            
            Run \`npm run test:fixtures:refresh\` to update.`;
            
            // Check if issue already exists
            const issues = await github.rest.issues.listForRepo({
              owner: context.repo.owner,
              repo: context.repo.repo,
              state: 'open',
              labels: 'fixtures-update'
            });
            
            if (issues.data.length === 0) {
              await github.rest.issues.create({
                owner: context.repo.owner,
                repo: context.repo.repo,
                title: title,
                body: body,
                labels: ['fixtures-update']
              });
            }
```

### 7.2 Test Scripts in package.json

```json
{
  "scripts": {
    "test": "vitest run",
    "test:unit": "vitest run tests/unit",
    "test:integration": "vitest run tests/integration",
    "test:fixtures:refresh": "bash scripts/refresh-test-fixtures.sh",
    "test:fixtures:check": "bash scripts/check-fixture-version.sh",
    "test:lab:setup": "bash scripts/setup-test-lab.sh",
    "test:lab:cleanup": "bash scripts/cleanup-test-lab.sh"
  }
}
```

### 7.3 Local Development Testing

```bash
# One-time setup
export BIGIP_TEST_HOST=10.1.1.100
export BIGIP_TEST_USER=admin
export BIGIP_TEST_PASS=yourpassword

# Check if fixtures need refresh (optional)
npm run test:fixtures:check

# Refresh fixtures if needed (downloads and commits)
npm run test:fixtures:refresh

# Setup lab partition
npm run test:lab:setup

# Run tests (fixtures loaded from repo)
npm run test:integration

# Cleanup
npm run test:lab:cleanup
```

**Note:** Fixtures are committed to the repo, so you typically don't need to refresh unless you want the latest corkscrew test data.

### 7.4 Test Reporting

Generate detailed test reports:

```typescript
// vitest.config.ts

export default {
  test: {
    reporters: ['verbose', 'json', 'html'],
    outputFile: {
      json: './test-results/results.json',
      html: './test-results/report.html',
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
    },
  },
};
```

---

## 8. Extended Test Matrix

Based on the 2025-12-29 full test run findings, these additional test scenarios are needed.

### 8.1 HA Pair Testing

The initial tests ran against a standalone device. HA-specific tests require a clustered pair.

| Test | Description | Tools |
|------|-------------|-------|
| HA status detection | Detect active/standby state | `ha_status` |
| Config sync trigger | Trigger sync to peer | `ha_sync` |
| Sync status verification | Verify sync completed | `ha_status` |
| Failover trigger | Force failover to peer | `ha_failover` |
| Failover verification | Verify new active device | `ha_status` |
| Traffic group management | List/modify traffic groups | `ha_traffic_groups` |
| Sync-only changes | Deploy, verify sync needed | `as3_deploy` + `ha_status` |

**HA Lab Requirements:**

| Component | Requirement |
|-----------|-------------|
| Device count | 2 BIG-IP (active/standby) |
| Device group | Sync-failover group configured |
| Network | Both devices reachable |
| Floating IP | Shared virtual addresses |

**HA Test Environment Variables:**

```bash
BIGIP_HA_PRIMARY=10.1.1.100
BIGIP_HA_SECONDARY=10.1.1.101
BIGIP_HA_FLOATING=10.1.1.102
BIGIP_HA_DEVICE_GROUP=device-group-1
```

### 8.2 Large Configuration Testing

Test behavior with production-scale configurations.

| Test | Scale | Expected Behavior |
|------|-------|-------------------|
| Many tenants | 50+ AS3 tenants | Pagination, reasonable response time |
| Many virtuals | 100+ per partition | List performance, filtering |
| Large pools | 500+ members | Member management, stats collection |
| Complex iRules | 1000+ lines | Parse, display, modification |
| Large UCS | 500MB+ archive | Progress reporting, timeout handling |
| Many partitions | 20+ partitions | Cross-partition queries |

**Scale Test Fixtures:**

```typescript
interface ScaleTestFixture {
  name: string;
  tenants: number;
  virtualsPerTenant: number;
  poolsPerTenant: number;
  membersPerPool: number;
  estimatedObjectCount: number;
}

const SCALE_FIXTURES: ScaleTestFixture[] = [
  {
    name: 'small',
    tenants: 5,
    virtualsPerTenant: 10,
    poolsPerTenant: 10,
    membersPerPool: 5,
    estimatedObjectCount: 500,
  },
  {
    name: 'medium',
    tenants: 20,
    virtualsPerTenant: 25,
    poolsPerTenant: 25,
    membersPerPool: 10,
    estimatedObjectCount: 5000,
  },
  {
    name: 'large',
    tenants: 50,
    virtualsPerTenant: 50,
    poolsPerTenant: 50,
    membersPerPool: 20,
    estimatedObjectCount: 25000,
  },
];
```

**Performance Assertions:**

```typescript
interface PerformanceThresholds {
  listTenants: number;      // ms - list all tenants
  getTenant: number;        // ms - get single tenant
  extractConfig: number;    // ms - extract_tenant_config
  deployTenant: number;     // ms - as3_deploy
  dryRun: number;           // ms - dry_run_as3
}

const THRESHOLDS: Record<string, PerformanceThresholds> = {
  small: {
    listTenants: 2000,
    getTenant: 1000,
    extractConfig: 30000,
    deployTenant: 10000,
    dryRun: 5000,
  },
  medium: {
    listTenants: 5000,
    getTenant: 2000,
    extractConfig: 60000,
    deployTenant: 30000,
    dryRun: 15000,
  },
  large: {
    listTenants: 10000,
    getTenant: 5000,
    extractConfig: 120000,
    deployTenant: 60000,
    dryRun: 30000,
  },
};
```

### 8.3 Functional Tests via Claude MCP Client

End-to-end tests using Claude as the MCP client, validating full agent workflows.

| Workflow | Steps | Validation |
|----------|-------|------------|
| Discovery | Connect → device_info → atc_versions | All info retrieved |
| Backup workflow | Connect → ucs_create → ucs_list → verify | Backup created |
| AS3 deployment | Connect → as3_deploy → verify → cleanup | Tenant deployed |
| Drift detection | Deploy → manual change → extract → compare | Drift detected |
| Troubleshooting | Connect → logs_get → stats_* → analyze | Issues identified |

**Functional Test Script Structure:**

```typescript
// tests/functional/workflows/deployment.test.ts

import { describe, it, expect } from 'vitest';
import { ClaudeMcpClient } from '../../helpers/claude-mcp-client';

describe('AS3 Deployment Workflow', () => {
  let claude: ClaudeMcpClient;
  
  beforeAll(async () => {
    claude = new ClaudeMcpClient();
    await claude.connect();
  });
  
  it('should complete full deployment workflow', async () => {
    // Step 1: User asks to deploy
    const response1 = await claude.chat(
      'Deploy a new HTTP application called test-app with VIP 10.99.99.99 and pool members 10.99.99.10, 10.99.99.11'
    );
    
    // Verify Claude called as3_deploy
    expect(response1.toolCalls).toContainEqual(
      expect.objectContaining({ tool: 'as3_deploy' })
    );
    
    // Step 2: Verify deployment
    const response2 = await claude.chat(
      'Verify the test-app was deployed correctly'
    );
    
    expect(response2.toolCalls).toContainEqual(
      expect.objectContaining({ tool: 'as3_get' })
    );
    
    // Step 3: Cleanup
    const response3 = await claude.chat(
      'Delete the test-app tenant'
    );
    
    expect(response3.toolCalls).toContainEqual(
      expect.objectContaining({ tool: 'as3_delete' })
    );
  });
});
```

### 8.4 Concurrent Operation Tests

Verify behavior when multiple operations run in parallel.

| Test | Description | Expected Behavior |
|------|-------------|-------------------|
| Parallel reads | Multiple `get_*` calls | All succeed, no interference |
| Parallel to different tenants | Deploy to 3 tenants simultaneously | All succeed independently |
| Read during write | Get pool while deploying | Read succeeds or waits |
| Multiple sessions | 2 MCP clients connected | Both work independently |
| Rapid fire | 10 requests in 1 second | Rate limiting or queuing |

### 8.5 Error Path Tests

Explicit tests for error conditions.

| Error Condition | Test | Expected Response |
|-----------------|------|-------------------|
| Invalid credentials | Connect with bad password | Clear auth error |
| Network timeout | Connect to unreachable host | Timeout error with duration |
| Invalid tenant name | Deploy with `!@#$%` | Validation error before API |
| Missing required field | Deploy AS3 without class | Schema validation error |
| Conflict | Create duplicate object | 409 Conflict with details |
| Not found | Get non-existent pool | 404 with object name |
| Disk full | Create UCS when disk full | Clear error, suggest cleanup |
| AS3 busy | Deploy while AS3 processing | 503 with retry suggestion |
| Version mismatch | Schema version > installed | Clear version guidance |

### 8.6 Certificate and SSL Tests

SSL/TLS-specific test coverage.

| Test | Description | Tools |
|------|-------------|-------|
| List certificates | Get all SSL certs | `certificate_list` |
| Certificate details | Get cert expiry, CN, SAN | `certificate_get` |
| Install certificate | Upload cert + key | `certificate_install` |
| Certificate profiles | Create client-ssl profile | Profile management |
| Expiry warnings | Detect expiring certs | Certificate analysis |
| Chain validation | Verify cert chain | Certificate validation |

### 8.7 SSH Operation Tests

Tests specific to SSH-based tools.

| Test | Description | Expected Behavior |
|------|-------------|-------------------|
| SSH connection | Establish SSH session | Session ID returned |
| Command execution | Run tmsh via SSH | Output captured |
| Persistent session | Multiple commands, one session | Session reused |
| Log tailing | `tail -F /var/log/ltm` | Real-time output |
| Long-running command | Command > 30s | Progress/streaming |
| Session cleanup | Disconnect properly | Resources released |
| Concurrent SSH | Multiple SSH sessions | Each independent |

### 8.8 Test Priority Matrix

| Priority | Category | Rationale |
|----------|----------|----------|
| P0 (Critical) | CRUD operations | Core functionality |
| P0 (Critical) | Error handling | User experience |
| P1 (High) | AS3 deployment | Primary use case |
| P1 (High) | Drift detection | Key feature |
| P2 (Medium) | HA operations | Production scenarios |
| P2 (Medium) | Scale testing | Performance validation |
| P3 (Low) | Edge cases | Completeness |
| P3 (Low) | Certificate ops | Less common |

---

## Appendix A: Corkscrew Test Data Contents

Based on corkscrew's test suite, expected objects:

| Object Type | Expected Count | Notes |
|-------------|----------------|-------|
| Virtual Servers | 7+ | Various types (HTTP, HTTPS, forwarding) |
| Pools | 7+ | Different LB methods |
| Nodes | 10+ | Various IPs |
| Monitors | 6+ | HTTP, HTTPS, TCP, ICMP |
| Profiles | 15+ | HTTP, TCP, SSL, persistence |
| iRules | 5+ | Redirects, headers, data groups |
| Policies | 3+ | Various conditions/actions |

## Appendix B: Environment Variable Reference

| Variable | Required | Description |
|----------|----------|-------------|
| `BIGIP_TEST_HOST` | Yes | Lab BIG-IP hostname/IP |
| `BIGIP_TEST_USER` | Yes | API username |
| `BIGIP_TEST_PASS` | Yes | API password |
| `BIGIP_TEST_PARTITION` | No | Test partition (default: test_mcp) |
| `BIGIP_VERIFY_SSL` | No | Verify SSL (default: false for lab) |
| `TEST_CLEANUP` | No | Cleanup after tests (default: true) |
| `TEST_VERBOSE` | No | Verbose output (default: false) |

## Appendix C: Related Documentation

- [f5-corkscrew](https://github.com/f5devcentral/f5-corkscrew) - Test data source
- [vscode-f5](https://github.com/f5devcentral/vscode-f5) - Example qkview usage
- [iControl REST API](https://clouddocs.f5.com/api/icontrol-rest/) - Verification reference
- [Vitest](https://vitest.dev/) - Test framework
