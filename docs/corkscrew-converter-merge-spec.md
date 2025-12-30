# Corkscrew + TMOS-Converter Architecture Review

**Status:** 📋 Proposal
**Date:** 2025-12-29
**Author:** Claude (from discussion with Snow)
**Related:** [as3-drift-detection-spec.md](./as3-drift-detection-spec.md)

---

## Executive Summary

This document analyzes merging **tmos-converter** functionality into **f5-corkscrew** to create a unified config extraction and AS3 conversion pipeline. The goal is simpler architecture, better maintainability, and improved developer experience.

---

## 1. Current State

### 1.1 Project Overview

| Project | Purpose | Owner | Language |
|---------|---------|-------|----------|
| **f5-corkscrew** | Parse .conf/UCS/qkview, extract apps | f5devcentral | TypeScript |
| **tmos-converter** | Convert TMOS objects to AS3 | f5devcentral | TypeScript |

### 1.2 Current Data Flow

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  BIG-IP     │     │  corkscrew  │     │   tmos-     │
│  Config     │────▶│  (parse)    │────▶│  converter  │────▶ AS3
│  UCS/qkview │     │             │     │  (convert)  │
└─────────────┘     └─────────────┘     └─────────────┘
                           │
                           ▼
                    TmosApp[] output
```

### 1.3 Integration Points in flipperAgents

```typescript
// Current: Two separate imports
import BigipConfig from 'f5-corkscrew';
import { convertToAs3 } from 'tmos-converter';

// Usage in as3-drift.ts
const bigip = new BigipConfig();
await bigip.loadParseAsync(ucsPath);
const apps = await bigip.apps();  // corkscrew output

const as3 = convertToAs3(apps);   // tmos-converter
```

### 1.4 Pain Points

| Issue | Impact |
|-------|--------|
| Two dependencies to manage | Version sync headaches |
| Separate release cycles | Integration breaks |
| Duplicated object models | Type mismatches |
| Two places to fix bugs | Slower fixes |
| Learning curve | Developers need to understand both |

---

## 2. Proposed Architecture

### 2.1 Merged Project Structure

```
f5-corkscrew/
├── src/
│   ├── core/                    # Existing corkscrew core
│   │   ├── BigipConfig.ts
│   │   ├── unPacker.ts
│   │   ├── tmosParser.ts
│   │   └── appExtractor.ts
│   │
│   ├── converters/              # NEW: From tmos-converter
│   │   ├── index.ts             # Main converter export
│   │   ├── as3/                 # AS3 conversion
│   │   │   ├── converter.ts
│   │   │   ├── virtualServer.ts
│   │   │   ├── pool.ts
│   │   │   ├── monitor.ts
│   │   │   ├── profile.ts
│   │   │   ├── irule.ts
│   │   │   └── policy.ts
│   │   └── types/               # Shared types
│   │       ├── as3.ts
│   │       └── tmos.ts
│   │
│   ├── models/                  # Unified object models
│   │   ├── TmosApp.ts
│   │   ├── VirtualServer.ts
│   │   ├── Pool.ts
│   │   └── ...
│   │
│   └── index.ts                 # Public API
│
├── tests/
│   ├── parsing/                 # Existing tests
│   └── conversion/              # NEW: Conversion tests
│
└── package.json
```

### 2.2 New Data Flow

```
┌─────────────┐     ┌─────────────────────────────────┐
│  BIG-IP     │     │         f5-corkscrew            │
│  Config     │────▶│  ┌─────────┐    ┌───────────┐   │────▶ AS3
│  UCS/qkview │     │  │  Parse  │───▶│  Convert  │   │
└─────────────┘     │  └─────────┘    └───────────┘   │
                    └─────────────────────────────────┘
```

### 2.3 Public API

```typescript
import BigipConfig from 'f5-corkscrew';

const bigip = new BigipConfig();
await bigip.loadParseAsync('/path/to/config.ucs');

// Existing API (unchanged)
const apps = await bigip.apps();
const explosion = await bigip.explode();

// NEW: Direct AS3 conversion
const as3Declaration = await bigip.toAs3({
  tenant: 'MyTenant',
  schemaVersion: '3.50.0',
  includeCommon: true
});

// NEW: Conversion with options
const result = await bigip.toAs3({
  tenant: 'MyTenant',
  options: {
    convertIrules: true,
    preserveDescriptions: true,
    handleUnsupported: 'warn'  // 'skip' | 'warn' | 'error'
  }
});

// Result includes conversion metadata
console.log(result.declaration);     // AS3 JSON
console.log(result.notes);           // Conversion notes
console.log(result.unsupported);     // Unsupported features
console.log(result.confidence);      // Overall confidence score
```

---

## 3. Migration Plan

### Phase 1: Preparation (Non-Breaking)

| Task | Effort | Notes |
|------|--------|-------|
| Create `converters/` directory in corkscrew | Low | Structure only |
| Define unified type interfaces | Medium | Consolidate types |
| Add tmos-converter as devDependency | Low | For reference during migration |

### Phase 2: Port Conversion Logic

| Task | Effort | Notes |
|------|--------|-------|
| Port virtual server converter | Medium | Core functionality |
| Port pool converter | Medium | Include members |
| Port monitor converter | Medium | Multiple types |
| Port profile converters | High | Many profile types |
| Port iRule converter | Medium | TCL analysis |
| Port policy converter | Medium | LTM policies |
| Write conversion tests | High | Port existing + new |

### Phase 3: Integration

| Task | Effort | Notes |
|------|--------|-------|
| Add `toAs3()` method to BigipConfig | Low | Public API |
| Add conversion options | Low | Configuration |
| Update documentation | Medium | README, examples |
| Create migration guide | Low | For existing users |

### Phase 4: Deprecation

| Task | Effort | Notes |
|------|--------|-------|
| Mark tmos-converter deprecated | Low | npm deprecation notice |
| Update flipperAgents to use new API | Low | Single import |
| Monitor for issues | Ongoing | Support period |
| Archive tmos-converter repo | Low | After 6 months |

---

## 4. Technical Considerations

### 4.1 Type Unification

**Current: Two separate type systems**

```typescript
// corkscrew types
interface TmosApp {
  name: string;
  config: string;
  map: object;
}

// tmos-converter types
interface TmosApplication {
  virtualServer: VirtualServer;
  pools: Pool[];
  // ...
}
```

**Proposed: Unified types**

```typescript
// Single source of truth in corkscrew
interface TmosApp {
  name: string;
  partition: string;
  
  // Parsed objects (existing)
  virtualServers: VirtualServer[];
  pools: Pool[];
  monitors: Monitor[];
  profiles: Profile[];
  irules: iRule[];
  policies: Policy[];
  
  // Raw config (existing)
  config: string;
  
  // Conversion metadata (new)
  as3Convertible: boolean;
  conversionNotes?: string[];
}
```

### 4.2 Conversion Confidence

Add conversion confidence scoring:

```typescript
interface ConversionResult {
  declaration: AS3Declaration;
  
  confidence: {
    overall: number;          // 0-100
    byObject: Map<string, {
      score: number;
      reason: string;
    }>;
  };
  
  notes: ConversionNote[];
  unsupported: UnsupportedFeature[];
}
```

### 4.3 Backwards Compatibility

Maintain existing corkscrew API:

```typescript
// These continue to work unchanged
const apps = await bigip.apps();
const explosion = await bigip.explode();
const logs = bigip.logs();

// New methods are additive
const as3 = await bigip.toAs3(options);
```

### 4.4 Bundle Size

| Current | Merged | Delta |
|---------|--------|-------|
| corkscrew: ~150KB | Combined: ~200KB | +50KB |
| tmos-converter: ~80KB | | |
| **Total: ~230KB** | **~200KB** | **-30KB** |

Merged bundle is smaller due to:
- Shared dependencies deduplicated
- Shared types not duplicated
- Single build output

---

## 5. Impact Analysis

### 5.1 flipperAgents Impact

| Component | Change Required |
|-----------|-----------------|
| `as3-drift.ts` | Update imports, simplify code |
| `package.json` | Remove tmos-converter dep |
| Tests | Update imports |

**Before:**
```typescript
import BigipConfig from 'f5-corkscrew';
import { convertToAs3 } from 'tmos-converter';

const bigip = new BigipConfig();
await bigip.loadParseAsync(ucsPath);
const apps = await bigip.apps();
const as3 = convertToAs3(apps, { tenant: 'MyTenant' });
```

**After:**
```typescript
import BigipConfig from 'f5-corkscrew';

const bigip = new BigipConfig();
await bigip.loadParseAsync(ucsPath);
const as3 = await bigip.toAs3({ tenant: 'MyTenant' });
```

### 5.2 vscode-f5 Impact

The vscode-f5 extension uses corkscrew for Config Explorer. No impact expected — existing API unchanged.

### 5.3 External Users

Users of tmos-converter would need to migrate:

```typescript
// Old
import { convertToAs3 } from 'tmos-converter';

// New
import BigipConfig from 'f5-corkscrew';
// Or for standalone conversion:
import { convertToAs3 } from 'f5-corkscrew/converters';
```

---

## 6. Decision Matrix

| Factor | Keep Separate | Merge |
|--------|---------------|-------|
| Maintenance burden | Higher | Lower ✅ |
| Version coordination | Required | Eliminated ✅ |
| Bundle size | Larger | Smaller ✅ |
| Breaking changes | None | Migration required |
| Single responsibility | ✅ Yes | Combined |
| Developer experience | Two docs | One doc ✅ |
| Release velocity | Independent | Coupled |

**Recommendation:** Merge. Benefits outweigh migration cost.

---

## 7. Open Questions

1. **Who drives the merge?** 
   - Option A: Fork corkscrew, add converters, propose PR
   - Option B: Create new repo, import both
   - Option C: Coordinate with f5devcentral maintainers

2. **Timeline?**
   - Depends on flipperAgents priorities
   - Could be deferred if current integration works

3. **Test data?**
   - Need representative configs for conversion testing
   - Use corkscrew's existing test fixtures
   - Add AS3-specific conversion tests

4. **AS3 schema versions?**
   - Bundle multiple schema versions?
   - Fetch latest from F5?
   - Use device's installed version?

---

## 8. Next Steps

If approved:

1. [ ] Open discussion with corkscrew maintainers
2. [ ] Create branch for converter integration
3. [ ] Port tmos-converter code with tests
4. [ ] Update flipperAgents to use new API
5. [ ] Document migration path
6. [ ] Deprecate tmos-converter

---

## Appendix A: Object Mapping Reference

| TMOS Object | AS3 Class | Confidence |
|-------------|-----------|------------|
| ltm virtual | Service_HTTP/HTTPS/TCP/UDP | High |
| ltm pool | Pool | High |
| ltm monitor http | Monitor | High |
| ltm profile tcp | TCP_Profile | High |
| ltm profile http | HTTP_Profile | High |
| ltm profile client-ssl | TLS_Client | High |
| ltm rule | iRule | Medium |
| ltm policy | Endpoint_Policy | Medium |
| ltm persistence | Persist | High |
| ltm snatpool | SNAT_Pool | High |
| ltm node | (Pool members) | High |
| sys file ssl-cert | Certificate | High |
| sys file ssl-key | Certificate (key) | High |

## Appendix B: Related Documentation

- [f5-corkscrew repo](https://github.com/f5devcentral/f5-corkscrew)
- [tmos-converter repo](https://github.com/f5devcentral/tmos-converter)
- [AS3 Schema Reference](https://clouddocs.f5.com/products/extensions/f5-appsvcs-extension/latest/refguide/schema-reference.html)
