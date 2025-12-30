/**
 * AS3 Drift Detection Tools
 *
 * Detects when live BIG-IP configuration diverges from AS3 source of truth.
 * Uses f5-corkscrew to extract and abstract applications, then converts to AS3 format.
 *
 * Key Principle: Leverage AS3's declarative model. The AS3 engine handles diffing
 * and applies only necessary changes — we don't need to replicate that logic.
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import type { F5Client } from '../lib/f5-client.js';
import type { Explosion, TmosApp } from 'f5-corkscrew';
import { writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { log } from '../lib/logger.js';
import {
  ProgressTracker,
  createExtractionTracker,
  createDryRunTracker,
  EXTRACTION_STEPS,
} from '../lib/progress.js';

// Handle CommonJS/ESM interop for f5-corkscrew (CommonJS module)
const require = createRequire(import.meta.url);
const BigipConfig = require('f5-corkscrew').default;

// ============================================================================
// Type Definitions (from spec)
// ============================================================================

interface ExtractedApplication {
  name: string;
  partition: string;
  destination?: string;
  pool?: {
    name: string;
    members: string[];
    monitors: string[];
  };
  profiles?: string[];
  rules?: string[];
  policies?: string[];
  persist?: string;
  description?: string;
  lines: string[];
}

interface ExtractTenantConfigResult {
  tenant: string;
  extracted_at: string;
  applications: ExtractedApplication[];
  common_references: string[];
  stats: {
    total_objects: number;
    source_version?: string;
  };
  // Progress metadata
  operation_id?: string;
  duration_ms?: number;
}

interface ConversionNote {
  object: string;
  note: string;
  confidence: 'high' | 'medium' | 'low';
}

interface UnsupportedObject {
  object: string;
  reason: string;
  recommendation: string;
}

interface ConvertToAs3Result {
  declaration: AS3Declaration;
  conversion_notes: ConversionNote[];
  unsupported: UnsupportedObject[];
}

interface ParseAs3DeclarationResult {
  valid: boolean;
  declaration: AS3Declaration | null;
  schema_version: string | null;
  tenants: string[];
  parse_errors: { message: string; location?: string }[];
}

interface ValidateAs3Result {
  valid: boolean;
  errors: { path: string; message: string; schema_path?: string }[];
  warnings: { path: string; message: string }[];
}

// Enhanced dry-run types (from spec update)
interface FieldChange {
  field: string;
  from: unknown;
  to: unknown;
  impact: 'low' | 'medium' | 'high';
}

interface PlannedChange {
  action: 'create' | 'modify' | 'delete' | 'none';
  object_type: 'tenant' | 'application' | 'virtual' | 'pool' | 'monitor' | 'profile' | 'irule' | 'policy' | 'other';
  object_path: string;
  summary: string;
  field_changes?: FieldChange[];
}

interface DryRunAs3Result {
  success: boolean;
  planned_changes: PlannedChange[];
  errors: { message: string; object?: string; remediation?: string }[];
  warnings: string[];
  raw_response?: unknown;
  operation_id?: string;
  duration_ms?: number;
}

// AS3 Declaration types (simplified)
interface AS3Declaration {
  class: 'AS3' | 'ADC';
  schemaVersion?: string;
  id?: string;
  action?: string;
  persist?: boolean;
  declaration?: AS3ADCDeclaration;
  [key: string]: unknown;
}

interface AS3ADCDeclaration {
  class: 'ADC';
  schemaVersion: string;
  id?: string;
  [tenantName: string]: unknown;
}

interface AS3Tenant {
  class: 'Tenant';
  [appName: string]: unknown;
}

interface AS3Application {
  class: 'Application';
  template?: string;
  [key: string]: unknown;
}

// ============================================================================
// Tool Definitions
// ============================================================================

export const as3DriftTools: Tool[] = [
  {
    name: 'extract_tenant_config',
    description: `Extract live BIG-IP configuration for a specific AS3 tenant/partition.

Uses mini-UCS export (faster than full UCS - excludes keys, certs, binaries)
and f5-corkscrew to parse and abstract applications.

**Progress Reporting:** This operation takes 60-120 seconds. Progress updates
are emitted via MCP notifications during execution:
- Step 1: Connecting to device (5%)
- Step 2: Creating mini-UCS archive (45%)
- Step 3: Downloading mini-UCS (70%)
- Step 4: Parsing with corkscrew (90%)
- Step 5: Filtering tenant objects (95%)
- Step 6: Building response (100%)

What this tool does:
1. Creates a mini-UCS from the BIG-IP (lightweight, fast)
2. Parses the config using corkscrew
3. Filters to the specified partition/tenant
4. Abstracts applications (groups virtual servers with their dependencies)
5. Returns structured config ready for AS3 conversion

Use for:
- Pre-migration config extraction
- Drift detection baseline
- Understanding current application structure
- Documenting live configuration

Output includes:
- List of applications with their components (pools, monitors, profiles)
- References to /Common objects used by this tenant
- Original TMOS config lines for audit trail
- Operation ID and duration for tracking

Related tools:
- convert_to_as3: Convert extracted config to AS3 format
- as3_get: Get current AS3 declaration (if tenant was deployed via AS3)
- dry_run_as3: Test AS3 declaration without applying`,
    inputSchema: {
      type: 'object',
      properties: {
        tenant: {
          type: 'string',
          description: 'AS3 tenant name (maps to BIG-IP partition). Use "Common" for /Common partition.',
        },
        include_common: {
          type: 'boolean',
          description: 'Include /Common objects referenced by this tenant (default: true)',
          default: true,
        },
      },
      required: ['tenant'],
    },
  },
  {
    name: 'convert_to_as3',
    description: `Convert extracted imperative BIG-IP config to AS3 declaration structure.

Takes the output from extract_tenant_config and generates an equivalent
AS3 declaration using proven object-to-AS3 mapping rules.

Conversion capabilities:
- Virtual servers → Service_HTTP/Service_HTTPS/Service_TCP/etc.
- Pools → Pool class with members
- Monitors → Monitor class (HTTP, HTTPS, TCP, ICMP, etc.)
- Profiles → Profile references
- Persistence → Persist class
- iRules → iRule class (with confidence notes)

Conversion confidence levels:
- HIGH: Direct mapping exists (Pool → Pool)
- MEDIUM: Equivalent exists with caveats (iRule → Endpoint_Policy)
- LOW: Best-effort approximation (complex TCL logic)

Use for:
- Migration from imperative to declarative config
- Generating AS3 baseline from existing config
- Drift detection (compare converted vs source AS3)

Returns:
- Complete AS3 declaration
- Conversion notes (what was converted and how)
- Unsupported features (what couldn't be converted)

Related tools:
- extract_tenant_config: Get config to convert
- validate_as3: Validate generated declaration
- dry_run_as3: Test declaration against device`,
    inputSchema: {
      type: 'object',
      properties: {
        extracted_config: {
          type: 'object',
          description: 'Output from extract_tenant_config tool',
        },
        schema_version: {
          type: 'string',
          description: 'Target AS3 schema version (default: 3.50.0)',
          default: '3.50.0',
        },
      },
      required: ['extracted_config'],
    },
  },
  {
    name: 'parse_as3_declaration',
    description: `Parse and validate structure of a user-provided AS3 declaration.

Validates JSON structure and extracts metadata without deploying to device.
Use this to check a declaration before comparison or deployment.

What it validates:
- Valid JSON syntax
- Required AS3 classes present (AS3/ADC, Tenant, Application)
- Schema version detection
- Tenant enumeration

Use for:
- Validating declaration before diff/comparison
- Extracting tenant list from complex declarations
- Pre-deployment structure check
- Understanding declaration scope

Does NOT validate:
- Full schema compliance (use validate_as3 for that)
- Object existence on device
- Semantic correctness

Related tools:
- validate_as3: Full schema validation
- dry_run_as3: Test against actual device
- convert_to_as3: Generate declaration from live config`,
    inputSchema: {
      type: 'object',
      properties: {
        declaration: {
          oneOf: [
            { type: 'string', description: 'AS3 declaration as JSON string' },
            { type: 'object', description: 'AS3 declaration as object' },
          ],
          description: 'AS3 declaration (JSON string or object)',
        },
      },
      required: ['declaration'],
    },
  },
  {
    name: 'validate_as3',
    description: `Validate AS3 declaration against the schema without deploying.

Performs full schema validation to catch errors before deployment.
Uses local AS3 schema validation (no device required).

Validates:
- All required properties present
- Property types match schema
- Enum values are valid
- Cross-references are valid within declaration

Common validation errors:
- Missing required properties (class, virtualAddresses, etc.)
- Invalid property types (string vs array)
- Unknown properties (typos in property names)
- Invalid enum values (persistence types, etc.)

Use for:
- Pre-deployment validation
- CI/CD pipeline checks
- Debugging declaration errors
- Learning AS3 structure

Related tools:
- parse_as3_declaration: Quick structure check
- dry_run_as3: Test against actual device (validates + checks resources)
- as3_deploy: Deploy after validation passes`,
    inputSchema: {
      type: 'object',
      properties: {
        declaration: {
          type: 'object',
          description: 'AS3 declaration object to validate',
        },
        schema_version: {
          type: 'string',
          description: 'Schema version to validate against (default: auto-detect from declaration)',
        },
      },
      required: ['declaration'],
    },
  },
  {
    name: 'dry_run_as3',
    description: `Test AS3 declaration against the device WITHOUT applying changes.

POSTs the declaration with ?controls.dryRun=true to see exactly what would change.
This is the safest way to preview AS3 deployment impact.

**Enhanced Response:** Returns detailed field-level changes with impact assessment:
- HIGH impact: Pool members, virtual addresses (affects traffic)
- MEDIUM impact: Persistence, timeouts (affects sessions)
- LOW impact: Descriptions, metadata (no traffic impact)

What dry-run shows:
- Objects that would be CREATED (new)
- Objects that would be MODIFIED (with field-level details)
- Objects that would be DELETED (removed from declaration)
- Objects unchanged (already match desired state)

Use for:
- Pre-deployment impact assessment
- Drift detection (compare vs no-change baseline)
- Validating declaration works with actual device state
- Training/learning without risk

Important notes:
- Requires active connection to BIG-IP
- AS3 must be installed on target device
- Shows what AS3 engine would do (not just text diff)
- Some errors only detected during actual device check

Related tools:
- validate_as3: Schema-only validation (no device needed)
- as3_get: Get current declaration to compare
- as3_deploy: Actually apply after dry-run looks good`,
    inputSchema: {
      type: 'object',
      properties: {
        declaration: {
          type: 'object',
          description: 'AS3 declaration to test',
        },
        tenant: {
          type: 'string',
          description: 'Tenant to target (if declaration contains multiple)',
        },
      },
      required: ['declaration'],
    },
  },
];

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Extract partition name from full object path
 * /Common/my_pool -> Common
 * /tenant1/app/vs -> tenant1
 */
function extractPartition(fullName: string): string {
  if (!fullName.startsWith('/')) return 'Common';
  const parts = fullName.split('/');
  return parts[1] || 'Common';
}

/**
 * Convert TmosApp from corkscrew to our ExtractedApplication format
 */
function convertTmosApp(app: TmosApp): ExtractedApplication {
  const poolMembers: string[] = [];
  const poolMonitors: string[] = [];

  if (app.pool) {
    // Extract pool members
    if (app.pool.members && typeof app.pool.members === 'object') {
      poolMembers.push(...Object.keys(app.pool.members));
    }
    // Extract monitors
    if (Array.isArray(app.pool.monitor)) {
      poolMonitors.push(...app.pool.monitor.map((m: unknown) =>
        typeof m === 'string' ? m : (m as { name?: string })?.name || String(m)
      ));
    }
  }

  return {
    name: app.name,
    partition: extractPartition(app.name),
    destination: app.destination,
    pool: app.pool ? {
      name: typeof app.pool === 'string' ? app.pool : app.pool.name || '',
      members: poolMembers,
      monitors: poolMonitors,
    } : undefined,
    profiles: app.profiles,
    rules: app.rules,
    policies: app.policies,
    persist: app.persist,
    description: app.description,
    lines: app.lines || [],
  };
}

/**
 * Find /Common references in application config
 */
function findCommonReferences(apps: ExtractedApplication[]): string[] {
  const commonRefs = new Set<string>();

  for (const app of apps) {
    // Check profiles
    app.profiles?.forEach(p => {
      if (p.startsWith('/Common/')) commonRefs.add(p);
    });

    // Check rules
    app.rules?.forEach(r => {
      if (r.startsWith('/Common/')) commonRefs.add(r);
    });

    // Check pool monitors
    app.pool?.monitors?.forEach(m => {
      if (m.startsWith('/Common/')) commonRefs.add(m);
    });

    // Check persist
    if (app.persist?.startsWith('/Common/')) {
      commonRefs.add(app.persist);
    }
  }

  return Array.from(commonRefs).sort();
}

/**
 * Generate AS3 declaration from extracted applications
 */
function generateAs3Declaration(
  tenant: string,
  apps: ExtractedApplication[],
  schemaVersion: string
): { declaration: AS3Declaration; notes: ConversionNote[]; unsupported: UnsupportedObject[] } {
  const notes: ConversionNote[] = [];
  const unsupported: UnsupportedObject[] = [];

  // Build tenant structure
  const tenantObj: AS3Tenant = { class: 'Tenant' };

  for (const app of apps) {
    const appName = app.name.split('/').pop() || app.name;
    const as3App: AS3Application = {
      class: 'Application',
      template: 'generic',
    };

    // Determine service class based on destination port
    const destPort = app.destination?.split(':').pop();
    let serviceClass = 'Service_TCP';
    if (destPort === '80') serviceClass = 'Service_HTTP';
    else if (destPort === '443') serviceClass = 'Service_HTTPS';

    // Create virtual server
    const vipAddress = app.destination?.split(':')[0];
    if (vipAddress) {
      as3App['serviceMain'] = {
        class: serviceClass,
        virtualAddresses: [vipAddress],
        virtualPort: parseInt(destPort || '0', 10),
        pool: app.pool ? `${appName}_pool` : undefined,
      };

      notes.push({
        object: app.name,
        note: `Converted to ${serviceClass}`,
        confidence: 'high',
      });
    }

    // Create pool if exists
    if (app.pool && app.pool.members.length > 0) {
      const poolMembers = app.pool.members.map(member => {
        const [addr, port] = member.split(':');
        return {
          servicePort: parseInt(port || '80', 10),
          serverAddresses: [addr],
        };
      });

      as3App[`${appName}_pool`] = {
        class: 'Pool',
        members: poolMembers,
        monitors: app.pool.monitors.length > 0
          ? app.pool.monitors.map(m => ({ use: m.split('/').pop() }))
          : [{ bigip: '/Common/tcp' }],
      };

      notes.push({
        object: app.pool.name,
        note: `Pool converted with ${app.pool.members.length} members`,
        confidence: 'high',
      });
    }

    // Handle iRules
    if (app.rules && app.rules.length > 0) {
      for (const rule of app.rules) {
        // Check if it's a /Common reference
        if (rule.startsWith('/Common/')) {
          // Reference existing iRule
          if (!as3App['serviceMain']) continue;
          const svc = as3App['serviceMain'] as Record<string, unknown>;
          if (!svc.iRules) svc.iRules = [];
          (svc.iRules as unknown[]).push({ bigip: rule });

          notes.push({
            object: rule,
            note: 'Referenced existing /Common iRule',
            confidence: 'medium',
          });
        } else {
          // Would need to extract iRule content - flag as needing review
          notes.push({
            object: rule,
            note: 'iRule requires manual review for conversion',
            confidence: 'low',
          });
        }
      }
    }

    // Handle unsupported features
    if (app.policies && app.policies.length > 0) {
      for (const policy of app.policies) {
        unsupported.push({
          object: policy,
          reason: 'Local Traffic Policies require manual conversion',
          recommendation: 'Review policy rules and convert to AS3 Endpoint_Policy or iRule',
        });
      }
    }

    tenantObj[appName] = as3App;
  }

  const declaration: AS3Declaration = {
    class: 'AS3',
    action: 'deploy',
    persist: true,
    declaration: {
      class: 'ADC',
      schemaVersion,
      id: `${tenant}-drift-detection-${Date.now()}`,
      [tenant]: tenantObj,
    },
  };

  return { declaration, notes, unsupported };
}

/**
 * Determine impact level for a field change
 */
function getFieldImpact(field: string): 'low' | 'medium' | 'high' {
  // High impact - affects traffic routing
  const highImpact = [
    'members', 'serverAddresses', 'servicePort',
    'virtualAddresses', 'virtualPort', 'destination',
    'pool', 'enable', 'disable',
  ];

  // Medium impact - affects session handling
  const mediumImpact = [
    'persistenceMethods', 'persist', 'timeout',
    'connectionLimit', 'rateLimit', 'monitor',
    'loadBalancingMode', 'serviceDownAction',
  ];

  if (highImpact.some(h => field.toLowerCase().includes(h.toLowerCase()))) {
    return 'high';
  }
  if (mediumImpact.some(m => field.toLowerCase().includes(m.toLowerCase()))) {
    return 'medium';
  }
  return 'low';
}

/**
 * Determine object type from AS3 class or path
 */
function getObjectType(classOrPath: string): PlannedChange['object_type'] {
  const lower = classOrPath.toLowerCase();
  if (lower.includes('tenant')) return 'tenant';
  if (lower.includes('application')) return 'application';
  if (lower.includes('service') || lower.includes('virtual')) return 'virtual';
  if (lower.includes('pool')) return 'pool';
  if (lower.includes('monitor')) return 'monitor';
  if (lower.includes('profile')) return 'profile';
  if (lower.includes('irule')) return 'irule';
  if (lower.includes('policy') || lower.includes('endpoint')) return 'policy';
  return 'other';
}

/**
 * Parse AS3 dry-run response into enhanced PlannedChange format
 */
function parseAs3DryRunResponse(
  data: Record<string, unknown>,
  declaration: AS3Declaration,
  tenant?: string
): { changes: PlannedChange[]; warnings: string[] } {
  const changes: PlannedChange[] = [];
  const warnings: string[] = [];

  // AS3 returns results array with per-tenant info
  const results = data.results as Array<Record<string, unknown>> | undefined;

  if (results && Array.isArray(results)) {
    for (const result of results) {
      const tenantName = (result.tenant as string) || tenant || 'unknown';
      const code = result.code as number;
      const message = result.message as string || '';

      if (code === 200 || code === 0) {
        // Success - determine what would change
        if (message.toLowerCase().includes('no change')) {
          changes.push({
            action: 'none',
            object_type: 'tenant',
            object_path: `/${tenantName}`,
            summary: 'No changes required - configuration matches desired state',
          });
        } else if (message.toLowerCase().includes('success')) {
          // Changes would be applied - try to extract details
          // The declaration object contains what would be created/modified
          const tenantDecl = declaration.declaration?.[tenantName] as Record<string, unknown> | undefined;
          
          if (tenantDecl) {
            // Enumerate applications and their objects
            for (const [key, value] of Object.entries(tenantDecl)) {
              if (key === 'class') continue;
              if (!value || typeof value !== 'object') continue;

              const obj = value as Record<string, unknown>;
              const objClass = obj.class as string || 'unknown';

              if (objClass === 'Application') {
                // Found an application - enumerate its objects
                for (const [appKey, appValue] of Object.entries(obj)) {
                  if (appKey === 'class' || appKey === 'template') continue;
                  if (!appValue || typeof appValue !== 'object') continue;

                  const appObj = appValue as Record<string, unknown>;
                  const appObjClass = appObj.class as string || 'unknown';

                  changes.push({
                    action: 'modify',  // Dry-run success means changes would apply
                    object_type: getObjectType(appObjClass),
                    object_path: `/${tenantName}/${key}/${appKey}`,
                    summary: `${appObjClass} would be created or modified`,
                  });
                }
              }
            }
          }

          // If we didn't find specific objects, add generic tenant change
          if (changes.length === 0) {
            changes.push({
              action: 'modify',
              object_type: 'tenant',
              object_path: `/${tenantName}`,
              summary: message || 'Changes would be applied',
            });
          }
        }
      } else if (code >= 400) {
        // Error case - handled in errors array by caller
        log.debug('AS3 result error', { code, message, tenant: tenantName });
      }

      // Collect warnings
      const resultWarnings = result.warnings as string[] | undefined;
      if (resultWarnings && Array.isArray(resultWarnings)) {
        warnings.push(...resultWarnings);
      }
    }
  }

  // If no results parsed, check for top-level response
  if (changes.length === 0 && data.code !== undefined) {
    const code = data.code as number;
    const message = data.message as string || '';

    if (code === 200) {
      changes.push({
        action: message.toLowerCase().includes('no change') ? 'none' : 'modify',
        object_type: 'tenant',
        object_path: tenant ? `/${tenant}` : '/declaration',
        summary: message || 'Declaration processed',
      });
    }
  }

  return { changes, warnings };
}

// ============================================================================
// Tool Handler
// ============================================================================

export async function handleAs3DriftTool(
  name: string,
  args: Record<string, unknown>,
  client: F5Client,
  server?: Server
): Promise<string> {
  switch (name) {
    // ========================================================================
    // extract_tenant_config
    // ========================================================================
    case 'extract_tenant_config': {
      const tenant = args.tenant as string;
      const includeCommon = args.include_common !== false;
      const startTime = Date.now();

      // Create progress tracker
      const progress = createExtractionTracker(server);

      log.info('Extracting tenant config', {
        tenant,
        includeCommon,
        operationId: progress.getId(),
      });

      // Step 1: Connecting
      await progress.update(1);

      // Get underlying f5-conx-core client for mini-UCS
      const coreClient = client.getClient();

      if (!coreClient.ucs) {
        throw new Error('UCS client not available');
      }

      // Create temp file path for mini-UCS
      const tempFile = join(tmpdir(), `mini-ucs-${Date.now()}.ucs`);

      try {
        // Step 2: Creating mini-UCS
        await progress.update(2, 'Creating mini-UCS archive (this takes ~60-90 seconds)');
        log.debug('Creating mini-UCS', { tempFile });

        await coreClient.ucs.get({
          localDestPathFile: tempFile,
          mini: true,
          noPrivateKeys: true,
        });

        // Step 3: Downloaded (the get() call includes download)
        await progress.update(3, 'Mini-UCS downloaded, parsing...');

        // Step 4: Parse with corkscrew
        await progress.update(4, 'Parsing configuration with corkscrew');
        log.debug('Parsing UCS with corkscrew');

        const bigip = new BigipConfig();
        await bigip.loadParseAsync(tempFile);
        const explosion: Explosion = await bigip.explode();

        log.debug('Corkscrew explosion complete', {
          totalApps: explosion.config.apps?.length || 0,
          objectCount: explosion.stats.objectCount,
          tmosVersion: explosion.stats.sourceTmosVersion,
        });

        // Step 5: Filter apps
        await progress.update(5, `Filtering to tenant: ${tenant}`);

        const allApps = explosion.config.apps || [];

        // Debug: log all app partitions to help diagnose filtering
        log.debug('All apps from corkscrew', {
          apps: allApps.map(app => ({ name: app.name, partition: app.partition })),
        });

        const tenantApps = allApps.filter(app => {
          // TmosApp already has partition property from corkscrew
          return app.partition.toLowerCase() === tenant.toLowerCase();
        });

        log.debug('Filtered apps for tenant', {
          tenant,
          matchedApps: tenantApps.length,
          totalApps: allApps.length,
        });

        // Convert to our format
        const applications = tenantApps.map(convertTmosApp);

        // Find /Common references if requested
        const commonReferences = includeCommon ? findCommonReferences(applications) : [];

        // Step 6: Build response
        await progress.update(6, 'Building response');

        const result: ExtractTenantConfigResult = {
          tenant,
          extracted_at: new Date().toISOString(),
          applications,
          common_references: commonReferences,
          stats: {
            total_objects: explosion.stats.objectCount || 0,
            source_version: explosion.stats.sourceTmosVersion,
          },
          operation_id: progress.getId(),
          duration_ms: Date.now() - startTime,
        };

        await progress.complete();

        log.info('Extraction complete', {
          tenant,
          applicationCount: applications.length,
          commonReferences: commonReferences.length,
          duration: Date.now() - startTime,
        });

        return JSON.stringify(result, null, 2);
      } finally {
        // Cleanup temp file
        try {
          unlinkSync(tempFile);
        } catch {
          // Ignore cleanup errors
        }
      }
    }

    // ========================================================================
    // convert_to_as3
    // ========================================================================
    case 'convert_to_as3': {
      const extractedConfig = args.extracted_config as ExtractTenantConfigResult;
      const schemaVersion = (args.schema_version as string) || '3.50.0';

      if (!extractedConfig || !extractedConfig.tenant || !extractedConfig.applications) {
        throw new Error('Invalid extracted_config: must be output from extract_tenant_config');
      }

      log.info('Converting to AS3', {
        tenant: extractedConfig.tenant,
        applicationCount: extractedConfig.applications.length,
        schemaVersion,
      });

      const { declaration, notes, unsupported } = generateAs3Declaration(
        extractedConfig.tenant,
        extractedConfig.applications,
        schemaVersion
      );

      log.info('Conversion complete', {
        tenant: extractedConfig.tenant,
        conversionNotes: notes.length,
        unsupportedObjects: unsupported.length,
        confidence: {
          high: notes.filter(n => n.confidence === 'high').length,
          medium: notes.filter(n => n.confidence === 'medium').length,
          low: notes.filter(n => n.confidence === 'low').length,
        },
      });

      const result: ConvertToAs3Result = {
        declaration,
        conversion_notes: notes,
        unsupported,
      };

      return JSON.stringify(result, null, 2);
    }

    // ========================================================================
    // parse_as3_declaration
    // ========================================================================
    case 'parse_as3_declaration': {
      const input = args.declaration;
      const errors: { message: string; location?: string }[] = [];
      let declaration: AS3Declaration | null = null;
      let schemaVersion: string | null = null;
      const tenants: string[] = [];

      try {
        // Parse if string
        if (typeof input === 'string') {
          declaration = JSON.parse(input) as AS3Declaration;
        } else {
          declaration = input as AS3Declaration;
        }

        // Validate basic structure
        if (!declaration.class) {
          errors.push({ message: 'Missing required "class" property', location: '/' });
        } else if (declaration.class !== 'AS3' && declaration.class !== 'ADC') {
          errors.push({
            message: `Invalid class: expected "AS3" or "ADC", got "${declaration.class}"`,
            location: '/class',
          });
        }

        // Find schema version and tenants
        let adcDecl: AS3ADCDeclaration | undefined;

        if (declaration.class === 'AS3' && declaration.declaration) {
          adcDecl = declaration.declaration as AS3ADCDeclaration;
        } else if (declaration.class === 'ADC') {
          adcDecl = declaration as unknown as AS3ADCDeclaration;
        }

        if (adcDecl) {
          schemaVersion = adcDecl.schemaVersion || null;

          // Find tenants (objects with class: Tenant)
          for (const [key, value] of Object.entries(adcDecl)) {
            if (
              value &&
              typeof value === 'object' &&
              (value as Record<string, unknown>).class === 'Tenant'
            ) {
              tenants.push(key);
            }
          }
        }

        if (!schemaVersion) {
          errors.push({ message: 'Could not detect schema version', location: '/schemaVersion' });
        }

        if (tenants.length === 0) {
          errors.push({ message: 'No Tenant objects found in declaration', location: '/' });
        }
      } catch (e) {
        errors.push({
          message: `JSON parse error: ${e instanceof Error ? e.message : String(e)}`,
        });
      }

      const result: ParseAs3DeclarationResult = {
        valid: errors.length === 0,
        declaration,
        schema_version: schemaVersion,
        tenants,
        parse_errors: errors,
      };

      return JSON.stringify(result, null, 2);
    }

    // ========================================================================
    // validate_as3
    // ========================================================================
    case 'validate_as3': {
      const declaration = args.declaration as AS3Declaration;
      const errors: { path: string; message: string; schema_path?: string }[] = [];
      const warnings: { path: string; message: string }[] = [];

      // Basic structural validation (full schema validation would require AS3 schema)
      // For now, validate key structural requirements

      if (!declaration) {
        errors.push({ path: '/', message: 'Declaration is required' });
      } else {
        // Check top-level class
        if (!declaration.class) {
          errors.push({ path: '/class', message: 'Missing required property: class' });
        }

        // Check for ADC declaration
        let adcDecl: AS3ADCDeclaration | undefined;
        if (declaration.class === 'AS3') {
          if (!declaration.declaration) {
            errors.push({ path: '/declaration', message: 'AS3 wrapper requires declaration property' });
          } else {
            adcDecl = declaration.declaration as AS3ADCDeclaration;
          }
        } else if (declaration.class === 'ADC') {
          adcDecl = declaration as unknown as AS3ADCDeclaration;
        }

        if (adcDecl) {
          if (!adcDecl.schemaVersion) {
            errors.push({ path: '/declaration/schemaVersion', message: 'Missing required property: schemaVersion' });
          }

          // Validate each tenant
          for (const [key, value] of Object.entries(adcDecl)) {
            if (key === 'class' || key === 'schemaVersion' || key === 'id') continue;

            if (value && typeof value === 'object') {
              const tenant = value as Record<string, unknown>;
              if (tenant.class !== 'Tenant') {
                warnings.push({
                  path: `/declaration/${key}`,
                  message: `Expected class "Tenant", found "${tenant.class}"`,
                });
              }

              // Validate applications within tenant
              for (const [appKey, appValue] of Object.entries(tenant)) {
                if (appKey === 'class') continue;

                if (appValue && typeof appValue === 'object') {
                  const app = appValue as Record<string, unknown>;
                  if (app.class !== 'Application') {
                    warnings.push({
                      path: `/declaration/${key}/${appKey}`,
                      message: `Expected class "Application", found "${app.class}"`,
                    });
                  }
                }
              }
            }
          }
        }
      }

      const result: ValidateAs3Result = {
        valid: errors.length === 0,
        errors,
        warnings,
      };

      return JSON.stringify(result, null, 2);
    }

    // ========================================================================
    // dry_run_as3
    // ========================================================================
    case 'dry_run_as3': {
      const declaration = args.declaration as AS3Declaration;
      const tenant = args.tenant as string | undefined;
      const startTime = Date.now();

      // Create progress tracker
      const progress = createDryRunTracker(server);

      log.info('Starting AS3 dry-run', {
        tenant,
        operationId: progress.getId(),
      });

      // Step 1: Validating
      await progress.update(1, 'Validating declaration structure');

      // POST to AS3 with dryRun controls parameter (AS3 3.30+)
      const coreClient = client.getClient();
      const path = tenant
        ? `/mgmt/shared/appsvcs/declare/${tenant}?controls.dryRun=true`
        : '/mgmt/shared/appsvcs/declare?controls.dryRun=true';

      try {
        // Step 2: Submit to AS3
        await progress.update(2, 'Submitting to AS3 engine');

        const response = await coreClient.https(path, {
          method: 'POST',
          data: declaration,
        });

        const data = response.data as Record<string, unknown>;

        // Step 3: Parse response
        await progress.update(3, 'Parsing AS3 response');

        const { changes: plannedChanges, warnings } = parseAs3DryRunResponse(
          data,
          declaration,
          tenant
        );

        const errors: DryRunAs3Result['errors'] = [];

        // Check for errors in results
        const results = data.results as Array<Record<string, unknown>> | undefined;
        if (results && Array.isArray(results)) {
          for (const result of results) {
            const code = result.code as number;
            if (code >= 400) {
              errors.push({
                message: (result.message as string) || 'Unknown error',
                object: result.tenant as string,
                remediation: 'Check declaration syntax and object references',
              });
            }
          }
        }

        // Step 4: Build report
        await progress.update(4, 'Building change report');

        const dryRunResult: DryRunAs3Result = {
          success: errors.length === 0,
          planned_changes: plannedChanges,
          errors,
          warnings,
          raw_response: data,
          operation_id: progress.getId(),
          duration_ms: Date.now() - startTime,
        };

        await progress.complete();

        log.info('Dry-run complete', {
          success: dryRunResult.success,
          changesCount: plannedChanges.length,
          errorsCount: errors.length,
          duration: Date.now() - startTime,
        });

        return JSON.stringify(dryRunResult, null, 2);
      } catch (error: unknown) {
        // Extract response body from axios error for better error messages
        let errorMessage = error instanceof Error ? error.message : String(error);
        let responseData: unknown = null;

        // Check if this is an axios error with response data
        if (error && typeof error === 'object' && 'response' in error) {
          const axiosError = error as { response?: { status?: number; data?: unknown } };
          if (axiosError.response?.data) {
            responseData = axiosError.response.data;
            // AS3 often returns detailed error info in the response body
            if (typeof responseData === 'object' && responseData !== null) {
              const data = responseData as Record<string, unknown>;
              if (data.message) {
                errorMessage = String(data.message);
              }
              if (data.errors && Array.isArray(data.errors)) {
                errorMessage += ': ' + data.errors.map((e: unknown) =>
                  typeof e === 'string' ? e : JSON.stringify(e)
                ).join('; ');
              }
            }
            log.error('AS3 dry-run failed', {
              status: axiosError.response.status,
              responseData,
            });
          }
        } else {
          log.error('AS3 dry-run failed', { error: errorMessage });
        }

        const dryRunResult: DryRunAs3Result = {
          success: false,
          planned_changes: [],
          errors: [{
            message: errorMessage,
            remediation: 'Verify AS3 is installed (atc_versions) and declaration is valid',
          }],
          warnings: [],
          raw_response: responseData || undefined,
          operation_id: progress.getId(),
          duration_ms: Date.now() - startTime,
        };

        return JSON.stringify(dryRunResult, null, 2);
      }
    }

    default:
      throw new Error(`Unknown AS3 drift tool: ${name}`);
  }
}
