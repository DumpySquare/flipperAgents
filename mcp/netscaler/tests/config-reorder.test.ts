import { describe, it, expect } from 'vitest';
import { reorderConfig, analyzeConfig } from '../src/lib/config-reorder.js';

describe('reorderConfig', () => {
  it('should reorder commands in dependency order', () => {
    const input = `
bind lb vserver web_vip svc_web1
add lb vserver web_vip HTTP 10.1.1.100 80
add service svc_web1 web_server1 HTTP 80
add server web_server1 192.168.1.10
    `.trim();

    const result = reorderConfig(input);
    const lines = result.split('\n').filter(l => l.trim() && !l.startsWith('#'));

    // Find positions of each command type
    const serverPos = lines.findIndex(l => l.includes('add server'));
    const servicePos = lines.findIndex(l => l.includes('add service'));
    const vserverPos = lines.findIndex(l => l.includes('add lb vserver'));
    const bindPos = lines.findIndex(l => l.includes('bind lb vserver'));

    // Verify ordering: server < service < vserver < binding
    expect(serverPos).toBeLessThan(servicePos);
    expect(servicePos).toBeLessThan(vserverPos);
    expect(vserverPos).toBeLessThan(bindPos);
  });

  it('should strip comments for batch compatibility', () => {
    const input = `
# This is a comment
add server web1 192.168.1.10
    `.trim();

    const result = reorderConfig(input);
    // Comments are stripped for NetScaler batch command compatibility
    expect(result).not.toContain('# This is a comment');
    expect(result).toContain('add server web1 192.168.1.10');
  });

  it('should handle empty input', () => {
    const result = reorderConfig('');
    // Empty input returns empty output (no header comment for batch compatibility)
    expect(result).toBe('');
  });

  it('should place set commands after add commands', () => {
    const input = `
set lb vserver web_vip -lbmethod LEASTCONNECTION
add lb vserver web_vip HTTP 10.1.1.100 80
    `.trim();

    const result = reorderConfig(input);
    const lines = result.split('\n').filter(l => l.trim() && !l.startsWith('#'));

    const addPos = lines.findIndex(l => l.includes('add lb vserver'));
    const setPos = lines.findIndex(l => l.includes('set lb vserver'));

    expect(addPos).toBeLessThan(setPos);
  });

  it('should place enable ns feature first, other enable/disable last', () => {
    const input = `
enable ns feature LB
add server web1 192.168.1.10
disable lb vserver old_vip
    `.trim();

    const result = reorderConfig(input);
    const lines = result.split('\n').filter(l => l.trim() && !l.startsWith('#'));

    const serverPos = lines.findIndex(l => l.includes('add server'));
    const enableFeaturePos = lines.findIndex(l => l.includes('enable ns feature'));
    const disablePos = lines.findIndex(l => l.includes('disable'));

    // enable ns feature should be first (before servers)
    expect(enableFeaturePos).toBeLessThan(serverPos);
    // disable vserver should be last (after servers)
    expect(serverPos).toBeLessThan(disablePos);
  });

  it('should handle SSL certificate ordering', () => {
    const input = `
bind ssl vserver web_vip -certkeyName my_cert
add ssl certKey my_cert -cert /nsconfig/ssl/my.crt -key /nsconfig/ssl/my.key
add lb vserver web_vip SSL 10.1.1.100 443
    `.trim();

    const result = reorderConfig(input);
    const lines = result.split('\n').filter(l => l.trim() && !l.startsWith('#'));

    const certPos = lines.findIndex(l => l.includes('add ssl certKey'));
    const vserverPos = lines.findIndex(l => l.includes('add lb vserver'));
    const bindPos = lines.findIndex(l => l.includes('bind ssl vserver'));

    expect(certPos).toBeLessThan(vserverPos);
    expect(vserverPos).toBeLessThan(bindPos);
  });

  it('should handle service groups', () => {
    const input = `
bind serviceGroup sg_web web1 80
add serviceGroup sg_web HTTP
add server web1 192.168.1.10
    `.trim();

    const result = reorderConfig(input);
    const lines = result.split('\n').filter(l => l.trim() && !l.startsWith('#'));

    const serverPos = lines.findIndex(l => l.includes('add server'));
    const sgPos = lines.findIndex(l => l.includes('add serviceGroup'));
    const bindPos = lines.findIndex(l => l.includes('bind serviceGroup'));

    expect(serverPos).toBeLessThan(sgPos);
    expect(sgPos).toBeLessThan(bindPos);
  });
});

describe('analyzeConfig', () => {
  it('should count different object types', () => {
    const input = `
add server web1 192.168.1.10
add server web2 192.168.1.11
add service svc1 web1 HTTP 80
add lb vserver web_vip HTTP 10.1.1.100 80
bind lb vserver web_vip svc1
    `.trim();

    const result = analyzeConfig(input);

    expect(result.servers).toBe(2);
    expect(result.services).toBe(1);
    expect(result.lbVservers).toBe(1);
    expect(result.bindings).toBe(1);
  });

  it('should ignore comments', () => {
    const input = `
# This is a comment
add server web1 192.168.1.10
# Another comment
    `.trim();

    const result = analyzeConfig(input);
    expect(result.servers).toBe(1);
  });

  it('should count monitors', () => {
    const input = `
add lb monitor http_mon HTTP
add lb monitor tcp_mon TCP
    `.trim();

    const result = analyzeConfig(input);
    expect(result.monitors).toBe(2);
  });

  it('should count SSL certificates', () => {
    const input = `
add ssl certKey cert1 -cert /nsconfig/ssl/cert1.crt -key /nsconfig/ssl/cert1.key
add ssl certKey cert2 -cert /nsconfig/ssl/cert2.crt -key /nsconfig/ssl/cert2.key
    `.trim();

    const result = analyzeConfig(input);
    expect(result.sslCertKeys).toBe(2);
  });

  it('should count policies', () => {
    const input = `
add cs policy pol1 -rule "HTTP.REQ.URL.CONTAINS(\"/api\")"
add responder action act1 respondwith "HTTP/1.1 200 OK"
add rewrite policy rew1 -rule TRUE -action act1
    `.trim();

    const result = analyzeConfig(input);
    expect(result.policies).toBe(3);
  });
});
