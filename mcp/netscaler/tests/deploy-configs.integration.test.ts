import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NitroClient } from '../src/lib/nitro-client.js';
import { SSHClient } from '../src/lib/ssh-client.js';
import { reorderConfig, analyzeConfig } from '../src/lib/config-reorder.js';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

/**
 * Integration tests that deploy each NS config file to the NetScaler
 *
 * Run with: npm run test:integration
 *
 * WARNING: This will clear and reconfigure the NetScaler for each config file!
 */

// Required environment variables - no defaults for security
const HOST = process.env.NS_HOST;
const USER = process.env.NS_USER || 'nsroot';
const PASS = process.env.NS_PASS;
const SSH_KEY = process.env.SSH_KEY;

if (!HOST || !PASS) {
  throw new Error('Integration tests require NS_HOST and NS_PASS environment variables');
}
if (!SSH_KEY) {
  throw new Error('Integration tests require SSH_KEY environment variable');
}

const NS_CONFIGS_DIR = join(__dirname, '../../../tests/ns-configs');

// Get all config files
const configFiles = readdirSync(NS_CONFIGS_DIR)
  .filter(f => f.endsWith('.conf'))
  .sort()
  .map(f => ({
    name: f,
    path: join(NS_CONFIGS_DIR, f),
  }));

describe('Deploy NS Config Files', () => {
  let nitroClient: NitroClient;
  let sshClient: SSHClient;

  beforeAll(async () => {
    nitroClient = new NitroClient({
      host: HOST,
      username: USER,
      password: PASS,
      validateSsl: false,
    });

    sshClient = new SSHClient({
      host: HOST,
      username: USER,
      privateKeyPath: SSH_KEY,
    });

    // Verify connectivity
    await nitroClient.login();
    console.log('✅ Connected to NetScaler:', HOST);

    // Clear any existing config before starting tests
    console.log('🧹 Clearing existing config...');
    await clearConfig(nitroClient);
  });

  afterAll(async () => {
    // Clean up - clear config at the end
    await clearConfig(nitroClient);
    await nitroClient.logout();
    console.log('✅ Cleaned up and disconnected');
  });

  // Run tests sequentially - each config file gets one comprehensive test
  it.each(configFiles)('$name - deploy and verify', async ({ name, path }) => {
    const content = readFileSync(path, 'utf-8');
    const reordered = reorderConfig(content);
    const analysis = analyzeConfig(content);

    console.log(`\n📦 Testing ${name}...`);
    console.log(`   Objects: ${analysis.servers} servers, ${analysis.services + analysis.serviceGroups} services, ${analysis.lbVservers} LB, ${analysis.csVservers} CS`);

    // Step 0: Fresh login to avoid session timeout
    await nitroClient.login();

    // Step 1: Clear existing config
    await clearConfig(nitroClient);

    // Step 2: Deploy via SSH batch
    let deployResult: string;
    try {
      deployResult = await sshClient.executeBatch(reordered);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.log(`   ❌ Deploy failed: ${msg.split('\n').slice(0, 3).join(', ')}`);
      throw error;
    }

    // Check for errors in batch output
    const errors = deployResult.split('\n').filter(l =>
      l.includes('ERROR:') &&
      !l.includes('already exists') // Ignore "already exists" for idempotent configs
    );

    if (errors.length > 0) {
      console.log(`   ⚠️  Warnings: ${errors.length} errors in output`);
    }

    console.log('   ✅ Deployed');

    // Step 3: Verify LB vservers
    const lbVservers = await nitroClient.getLbVservers();
    console.log(`   Found ${lbVservers.length} LB vservers (expected ${analysis.lbVservers})`);
    expect(lbVservers.length).toBeGreaterThanOrEqual(analysis.lbVservers);

    // Step 4: Verify CS vservers if expected
    if (analysis.csVservers > 0) {
      const csVservers = await nitroClient.getCsVservers();
      console.log(`   Found ${csVservers.length} CS vservers (expected ${analysis.csVservers})`);
      expect(csVservers.length).toBeGreaterThanOrEqual(analysis.csVservers);
    }

    // Step 5: Save config
    await nitroClient.saveConfig();
    console.log('   ✅ Config saved');

  }, 120000); // 2 minute timeout per config
});

/**
 * Clear application configuration via NITRO API
 * Deletes objects in reverse dependency order
 *
 * WARNING: Do NOT use 'clear ns config -force extended' - it resets the NSIP and breaks Azure NAT!
 *
 * Deletion order (reverse dependency):
 * 1. CS policy bindings (unbind from csvserver)
 * 2. CS vservers
 * 3. CS policies (reference CS actions)
 * 4. CS actions (reference LB vservers)
 * 5. Responder/Rewrite policies
 * 6. LB vservers
 * 7. GSLB vservers
 * 8. Services
 * 9. Service groups
 * 10. Servers
 * 11. Custom monitors
 * 12. SSL certkeys
 */
async function clearConfig(client: NitroClient): Promise<void> {
  const deleteResource = async (path: string): Promise<void> => {
    try {
      await client.delete(path);
    } catch {
      // Ignore errors - resource may not exist or may be protected
    }
  };

  try {
    // Delete in reverse dependency order

    // 1. CS vservers (must be deleted before CS policies/actions)
    const csVservers = await client.getCsVservers();
    for (const vs of csVservers) {
      await deleteResource(`/config/csvserver/${encodeURIComponent(vs.name)}`);
    }

    // 2. CS policies (reference CS actions)
    interface CSPolicyResponse { errorcode: number; message: string; cspolicy?: Array<{ policyname: string }> }
    try {
      const csPoliciesResp = await client.get<CSPolicyResponse>('/config/cspolicy');
      for (const pol of csPoliciesResp.cspolicy || []) {
        await deleteResource(`/config/cspolicy/${encodeURIComponent(pol.policyname)}`);
      }
    } catch { /* no CS policies */ }

    // 3. CS actions (reference LB vservers - must delete before LB vservers)
    interface CSActionResponse { errorcode: number; message: string; csaction?: Array<{ name: string }> }
    try {
      const csActionsResp = await client.get<CSActionResponse>('/config/csaction');
      for (const action of csActionsResp.csaction || []) {
        await deleteResource(`/config/csaction/${encodeURIComponent(action.name)}`);
      }
    } catch { /* no CS actions */ }

    // 4. Responder policies
    interface ResponderPolicyResponse { errorcode: number; message: string; responderpolicy?: Array<{ name: string }> }
    try {
      const responderPoliciesResp = await client.get<ResponderPolicyResponse>('/config/responderpolicy');
      for (const pol of responderPoliciesResp.responderpolicy || []) {
        await deleteResource(`/config/responderpolicy/${encodeURIComponent(pol.name)}`);
      }
    } catch { /* no responder policies */ }

    // 5. Responder actions
    interface ResponderActionResponse { errorcode: number; message: string; responderaction?: Array<{ name: string }> }
    try {
      const responderActionsResp = await client.get<ResponderActionResponse>('/config/responderaction');
      for (const action of responderActionsResp.responderaction || []) {
        await deleteResource(`/config/responderaction/${encodeURIComponent(action.name)}`);
      }
    } catch { /* no responder actions */ }

    // 6. Rewrite policies
    interface RewritePolicyResponse { errorcode: number; message: string; rewritepolicy?: Array<{ name: string }> }
    try {
      const rewritePoliciesResp = await client.get<RewritePolicyResponse>('/config/rewritepolicy');
      for (const pol of rewritePoliciesResp.rewritepolicy || []) {
        await deleteResource(`/config/rewritepolicy/${encodeURIComponent(pol.name)}`);
      }
    } catch { /* no rewrite policies */ }

    // 7. Rewrite actions
    interface RewriteActionResponse { errorcode: number; message: string; rewriteaction?: Array<{ name: string }> }
    try {
      const rewriteActionsResp = await client.get<RewriteActionResponse>('/config/rewriteaction');
      for (const action of rewriteActionsResp.rewriteaction || []) {
        await deleteResource(`/config/rewriteaction/${encodeURIComponent(action.name)}`);
      }
    } catch { /* no rewrite actions */ }

    // 8. LB vservers
    const lbVservers = await client.getLbVservers();
    for (const vs of lbVservers) {
      await deleteResource(`/config/lbvserver/${encodeURIComponent(vs.name)}`);
    }

    // 9. GSLB vservers
    interface GSLBVserverResponse { errorcode: number; message: string; gslbvserver?: Array<{ name: string }> }
    try {
      const gslbVserversResp = await client.get<GSLBVserverResponse>('/config/gslbvserver');
      for (const vs of gslbVserversResp.gslbvserver || []) {
        await deleteResource(`/config/gslbvserver/${encodeURIComponent(vs.name)}`);
      }
    } catch { /* no GSLB vservers */ }

    // 10. Services
    interface ServiceResponse { errorcode: number; message: string; service?: Array<{ name: string }> }
    try {
      const servicesResp = await client.get<ServiceResponse>('/config/service');
      for (const svc of servicesResp.service || []) {
        await deleteResource(`/config/service/${encodeURIComponent(svc.name)}`);
      }
    } catch { /* no services */ }

    // 11. Service groups
    interface SGResponse { errorcode: number; message: string; servicegroup?: Array<{ servicegroupname: string }> }
    try {
      const sgResp = await client.get<SGResponse>('/config/servicegroup');
      for (const sg of sgResp.servicegroup || []) {
        await deleteResource(`/config/servicegroup/${encodeURIComponent(sg.servicegroupname)}`);
      }
    } catch { /* no service groups */ }

    // 12. Servers (skip internal)
    interface ServerResponse { errorcode: number; message: string; server?: Array<{ name: string; internal?: string }> }
    try {
      const serversResp = await client.get<ServerResponse>('/config/server');
      for (const srv of serversResp.server || []) {
        if (srv.internal !== 'True') {
          await deleteResource(`/config/server/${encodeURIComponent(srv.name)}`);
        }
      }
    } catch { /* no servers */ }

    // 13. Custom monitors (skip built-in)
    interface MonitorResponse { errorcode: number; message: string; lbmonitor?: Array<{ monitorname: string; type: string; builtin?: string[] }> }
    try {
      const monitorsResp = await client.get<MonitorResponse>('/config/lbmonitor');
      for (const mon of monitorsResp.lbmonitor || []) {
        // Skip built-in monitors
        if (!mon.builtin || mon.builtin.length === 0) {
          await deleteResource(`/config/lbmonitor/${encodeURIComponent(mon.monitorname)}?args=type:${mon.type}`);
        }
      }
    } catch { /* no monitors */ }

    // 14. SSL certkeys (skip built-in)
    interface SSLCertKeyResponse { errorcode: number; message: string; sslcertkey?: Array<{ certkey: string; builtin?: string[] }> }
    try {
      const sslCertKeysResp = await client.get<SSLCertKeyResponse>('/config/sslcertkey');
      for (const cert of sslCertKeysResp.sslcertkey || []) {
        // Skip built-in certificates
        if (!cert.builtin || cert.builtin.length === 0) {
          await deleteResource(`/config/sslcertkey/${encodeURIComponent(cert.certkey)}`);
        }
      }
    } catch { /* no SSL certkeys */ }

    // Small delay for NetScaler to process deletions
    await new Promise(resolve => setTimeout(resolve, 1000));

  } catch (error) {
    console.log('   ⚠️  Error during clear:', error);
  }
}
