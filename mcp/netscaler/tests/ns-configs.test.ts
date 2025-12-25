import { describe, it, expect, beforeAll } from 'vitest';
import { reorderConfig, analyzeConfig } from '../src/lib/config-reorder.js';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

/**
 * Tests config reordering against all NS config files in tests/ns-configs/
 */

const NS_CONFIGS_DIR = join(__dirname, '../../../tests/ns-configs');

// Get all config files
const configFiles = readdirSync(NS_CONFIGS_DIR)
  .filter(f => f.endsWith('.conf'))
  .map(f => ({
    name: f,
    path: join(NS_CONFIGS_DIR, f),
  }));

describe('NS Config Files', () => {
  describe.each(configFiles)('$name', ({ name, path }) => {
    let content: string;
    let reordered: string;
    let analysis: Record<string, number>;

    beforeAll(() => {
      content = readFileSync(path, 'utf-8');
      reordered = reorderConfig(content);
      analysis = analyzeConfig(content);
    });

    it('should parse without errors', () => {
      expect(content).toBeDefined();
      expect(content.length).toBeGreaterThan(0);
    });

    it('should reorder without errors', () => {
      expect(reordered).toBeDefined();
      expect(reordered.length).toBeGreaterThan(0);
    });

    it('should preserve commands after cleaning and filtering', () => {
      // Helper to check if a line is an auto-created IP-named server
      // Format: add server <IP> <IP> (name equals IP address)
      const isAutoCreatedServer = (line: string): boolean => {
        const ipv4Pattern = /^add server\s+(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\s+\1(\s|$)/;
        const ipv6Pattern = /^add server\s+([0-9a-fA-F:]+)\s+\1(\s|$)/;
        return ipv4Pattern.test(line) || ipv6Pattern.test(line);
      };

      // Helper to clean a command (remove -devno option)
      const cleanCommand = (line: string): string => {
        return line.replace(/\s+-devno\s+\d+/g, '');
      };

      const originalLines = content
        .split('\n')
        .map(l => l.trim())
        .filter(l => l && !l.startsWith('#'))
        .filter(l => !isAutoCreatedServer(l))  // Filter auto-created servers
        .map(l => cleanCommand(l));            // Clean -devno options

      const reorderedLines = reordered
        .split('\n')
        .map(l => l.trim())
        .filter(l => l && !l.startsWith('#'));

      // All cleaned original commands should be in reordered output
      for (const line of originalLines) {
        expect(reorderedLines).toContain(line);
      }
    });

    it('should have servers before services', () => {
      const lines = reordered.split('\n').filter(l => l.trim() && !l.startsWith('#'));

      const serverLines = lines.filter(l => /^add server\s/.test(l.trim()));
      const serviceLines = lines.filter(l => /^add service\s(?!Group)/.test(l.trim()));

      if (serverLines.length > 0 && serviceLines.length > 0) {
        const lastServerIdx = Math.max(...serverLines.map(l => lines.indexOf(l)));
        const firstServiceIdx = Math.min(...serviceLines.map(l => lines.indexOf(l)));
        expect(lastServerIdx).toBeLessThan(firstServiceIdx);
      }
    });

    it('should have services before LB vservers', () => {
      const lines = reordered.split('\n').filter(l => l.trim() && !l.startsWith('#'));

      const serviceLines = lines.filter(l => /^add service\s/.test(l.trim()));
      const vserverLines = lines.filter(l => /^add lb vserver\s/.test(l.trim()));

      if (serviceLines.length > 0 && vserverLines.length > 0) {
        const lastServiceIdx = Math.max(...serviceLines.map(l => lines.indexOf(l)));
        const firstVserverIdx = Math.min(...vserverLines.map(l => lines.indexOf(l)));
        expect(lastServiceIdx).toBeLessThan(firstVserverIdx);
      }
    });

    it('should have add commands before bind commands for same object type', () => {
      const lines = reordered.split('\n').filter(l => l.trim() && !l.startsWith('#'));

      const addLbVserverLines = lines.filter(l => /^add lb vserver\s/.test(l.trim()));
      const bindLbVserverLines = lines.filter(l => /^bind lb vserver\s/.test(l.trim()));

      if (addLbVserverLines.length > 0 && bindLbVserverLines.length > 0) {
        const lastAddIdx = Math.max(...addLbVserverLines.map(l => lines.indexOf(l)));
        const firstBindIdx = Math.min(...bindLbVserverLines.map(l => lines.indexOf(l)));
        expect(lastAddIdx).toBeLessThan(firstBindIdx);
      }
    });

    it('should produce valid analysis', () => {
      expect(analysis).toHaveProperty('servers');
      expect(analysis).toHaveProperty('services');
      expect(analysis).toHaveProperty('lbVservers');
      expect(analysis).toHaveProperty('bindings');

      // All counts should be non-negative
      Object.values(analysis).forEach(count => {
        expect(count).toBeGreaterThanOrEqual(0);
      });
    });

    it('should log analysis summary', () => {
      const total = Object.values(analysis).reduce((a, b) => a + b, 0);
      console.log(`  ${name}: ${total} commands (${analysis.lbVservers} LB, ${analysis.csVservers} CS, ${analysis.services} svc, ${analysis.servers} srv)`);
    });
  });
});

describe('Config Analysis Summary', () => {
  it('should analyze all configs', () => {
    console.log('\n=== Config Analysis Summary ===');

    const summaries = configFiles.map(({ name, path }) => {
      const content = readFileSync(path, 'utf-8');
      const analysis = analyzeConfig(content);
      const lines = content.split('\n').length;
      return { name, lines, ...analysis };
    });

    // Print table
    console.log('Config File              | Lines | Srv | Svc | LB  | CS  | SSL | Bind');
    console.log('-------------------------|-------|-----|-----|-----|-----|-----|-----');

    for (const s of summaries) {
      const row = [
        s.name.padEnd(24),
        String(s.lines).padStart(5),
        String(s.servers).padStart(3),
        String(s.services + s.serviceGroups).padStart(3),
        String(s.lbVservers).padStart(3),
        String(s.csVservers).padStart(3),
        String(s.sslCertKeys).padStart(3),
        String(s.bindings).padStart(4),
      ].join(' | ');
      console.log(row);
    }

    // Totals
    const totals = summaries.reduce(
      (acc, s) => ({
        lines: acc.lines + s.lines,
        servers: acc.servers + s.servers,
        services: acc.services + s.services + s.serviceGroups,
        lbVservers: acc.lbVservers + s.lbVservers,
        csVservers: acc.csVservers + s.csVservers,
        sslCertKeys: acc.sslCertKeys + s.sslCertKeys,
        bindings: acc.bindings + s.bindings,
      }),
      { lines: 0, servers: 0, services: 0, lbVservers: 0, csVservers: 0, sslCertKeys: 0, bindings: 0 }
    );

    console.log('-------------------------|-------|-----|-----|-----|-----|-----|-----');
    console.log(
      [
        'TOTALS'.padEnd(24),
        String(totals.lines).padStart(5),
        String(totals.servers).padStart(3),
        String(totals.services).padStart(3),
        String(totals.lbVservers).padStart(3),
        String(totals.csVservers).padStart(3),
        String(totals.sslCertKeys).padStart(3),
        String(totals.bindings).padStart(4),
      ].join(' | ')
    );

    expect(summaries.length).toBe(configFiles.length);
  });
});
