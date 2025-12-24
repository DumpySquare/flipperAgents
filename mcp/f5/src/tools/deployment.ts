/**
 * ATC Deployment Tools
 *
 * AS3, DO, and TS declarative deployment operations.
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { F5Client } from '../lib/f5-client.js';

export const deploymentTools: Tool[] = [
  // AS3 Tools
  {
    name: 'as3_get',
    description:
      'Get the current AS3 declaration from the BIG-IP. Optionally filter by tenant.',
    inputSchema: {
      type: 'object',
      properties: {
        tenant: {
          type: 'string',
          description: 'Optional tenant name to filter',
        },
      },
    },
  },
  {
    name: 'as3_deploy',
    description:
      'Deploy an AS3 declaration to the BIG-IP. AS3 is a declarative API for configuring application services.',
    inputSchema: {
      type: 'object',
      properties: {
        declaration: {
          type: 'object',
          description: 'AS3 declaration object',
        },
      },
      required: ['declaration'],
    },
  },
  {
    name: 'as3_delete',
    description: 'Delete an AS3 tenant from the BIG-IP.',
    inputSchema: {
      type: 'object',
      properties: {
        tenant: {
          type: 'string',
          description: 'Tenant name to delete',
        },
        confirm: {
          type: 'boolean',
          description: 'Must be true to confirm deletion',
        },
      },
      required: ['tenant', 'confirm'],
    },
  },
  // DO Tools
  {
    name: 'do_get',
    description:
      'Get the current Declarative Onboarding (DO) configuration from the BIG-IP.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'do_deploy',
    description:
      'Deploy a Declarative Onboarding (DO) declaration. DO configures system settings like hostname, NTP, DNS.',
    inputSchema: {
      type: 'object',
      properties: {
        declaration: {
          type: 'object',
          description: 'DO declaration object',
        },
      },
      required: ['declaration'],
    },
  },
  // TS Tools
  {
    name: 'ts_get',
    description:
      'Get the current Telemetry Streaming (TS) configuration from the BIG-IP.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'ts_deploy',
    description:
      'Deploy a Telemetry Streaming (TS) declaration. TS configures metric/log streaming to external systems.',
    inputSchema: {
      type: 'object',
      properties: {
        declaration: {
          type: 'object',
          description: 'TS declaration object',
        },
      },
      required: ['declaration'],
    },
  },
  {
    name: 'ts_delete',
    description: 'Delete the Telemetry Streaming configuration.',
    inputSchema: {
      type: 'object',
      properties: {
        confirm: {
          type: 'boolean',
          description: 'Must be true to confirm deletion',
        },
      },
      required: ['confirm'],
    },
  },
  // ATC Management
  {
    name: 'atc_versions',
    description:
      'List installed ATC (Automation Toolchain) package versions: AS3, DO, TS, CF.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
];

export async function handleDeploymentTool(
  name: string,
  args: Record<string, unknown>,
  client: F5Client
): Promise<string> {
  switch (name) {
    // AS3
    case 'as3_get': {
      const tenant = args.tenant as string | undefined;
      const declaration = await client.as3Get(tenant);
      return JSON.stringify(declaration, null, 2);
    }

    case 'as3_deploy': {
      const declaration = args.declaration as unknown;
      const result = await client.as3Deploy(declaration);
      return JSON.stringify({
        success: true,
        message: 'AS3 declaration deployed',
        result,
      }, null, 2);
    }

    case 'as3_delete': {
      if (!args.confirm) {
        return JSON.stringify({
          error: 'Must set confirm=true to delete tenant',
        });
      }
      const tenant = args.tenant as string;
      const result = await client.as3Delete(tenant);
      return JSON.stringify({
        success: true,
        message: `AS3 tenant deleted: ${tenant}`,
        result,
      }, null, 2);
    }

    // DO
    case 'do_get': {
      const declaration = await client.doGet();
      return JSON.stringify(declaration, null, 2);
    }

    case 'do_deploy': {
      const declaration = args.declaration as unknown;
      const result = await client.doDeploy(declaration);
      return JSON.stringify({
        success: true,
        message: 'DO declaration deployed',
        result,
      }, null, 2);
    }

    // TS
    case 'ts_get': {
      const declaration = await client.tsGet();
      return JSON.stringify(declaration, null, 2);
    }

    case 'ts_deploy': {
      const declaration = args.declaration as unknown;
      const result = await client.tsDeploy(declaration);
      return JSON.stringify({
        success: true,
        message: 'TS declaration deployed',
        result,
      }, null, 2);
    }

    case 'ts_delete': {
      if (!args.confirm) {
        return JSON.stringify({
          error: 'Must set confirm=true to delete TS configuration',
        });
      }
      const result = await client.tsDelete();
      return JSON.stringify({
        success: true,
        message: 'TS configuration deleted',
        result,
      }, null, 2);
    }

    // ATC versions
    case 'atc_versions': {
      const versions = await client.atcGetVersions();
      return JSON.stringify({
        success: true,
        versions,
      }, null, 2);
    }

    default:
      throw new Error(`Unknown deployment tool: ${name}`);
  }
}
