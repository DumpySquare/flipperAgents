/**
 * NetScaler Configuration Reorderer
 *
 * Parses NetScaler configuration and reorders commands into
 * dependency-safe execution order.
 *
 * Dependency order:
 * 1. GSLB Sites (no dependencies - needed by GSLB services)
 * 2. Servers (no dependencies)
 * 3. Monitors (no dependencies)
 * 4. SSL certificates (no dependencies)
 * 5. Service Groups (no dependencies initially)
 * 6. Services (depend on servers)
 * 7. GSLB Services (depend on sites + servers)
 * 8. Service Group bindings (depend on servers + service groups)
 * 9. Service bindings (depend on services + monitors)
 * 10. LB Virtual Servers (can exist empty)
 * 11. CS Virtual Servers (can exist empty)
 * 12. GSLB Virtual Servers (can exist empty)
 * 13. Actions (CS, responder, rewrite - must come before policies)
 * 14. Policies (CS, responder, rewrite - reference actions)
 * 15. LB vserver bindings (depend on vservers + services)
 * 16. CS vserver bindings (depend on cs vservers + lb vservers)
 * 17. SSL bindings (depend on vservers + certificates)
 * 18. GSLB bindings (depend on vservers + services)
 * 19. Set commands (modify existing objects)
 * 20. Link commands
 * 21. Enable/Disable commands (must be last)
 */

interface CommandGroup {
  pattern: RegExp;
  commands: string[];
}

/**
 * Clean a command line by removing internal NetScaler options
 * that shouldn't be in deployment configs
 */
function cleanCommand(line: string): string {
  // Remove -devno option (internal device number)
  return line.replace(/\s+-devno\s+\d+/g, '');
}

/**
 * Check if a server command is an auto-created IP-named server
 * NetScaler auto-creates these when services reference IPs directly
 * Format: add server <IP> <IP> (name equals IP address)
 *
 * These should be filtered out during deployment because:
 * 1. They'll be auto-created when the service is added
 * 2. Re-deploying would fail with "Resource already exists"
 *
 * @see docs/FLIPPER_INTEGRATION_NOTES.md for abstraction guidance
 */
function isAutoCreatedServer(line: string): boolean {
  // Match: add server <IP> <IP> [optional flags]
  // IPv4: add server 10.240.31.100 10.240.31.100
  // IPv6: add server 2001:db8::1 2001:db8::1
  const ipv4Pattern = /^add server\s+(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\s+\1(\s|$)/;
  const ipv6Pattern = /^add server\s+([0-9a-fA-F:]+)\s+\1(\s|$)/;

  return ipv4Pattern.test(line) || ipv6Pattern.test(line);
}

export function reorderConfig(config: string): string {
  const lines = config.split('\n');

  // Define command groups in dependency order
  const groups: CommandGroup[] = [
    // Group 0: Features (enable before anything else)
    { pattern: /^enable ns feature\s/, commands: [] },

    // Group 1: GSLB Sites (must be first - GSLB services depend on them)
    { pattern: /^add gslb site\s/, commands: [] },

    // Group 1.5: Profiles (must be before vservers/services that reference them)
    { pattern: /^add ns (tcp|http|net)Profile\s/, commands: [] },
    { pattern: /^add ssl profile\s/, commands: [] },
    { pattern: /^add dns profile\s/, commands: [] },

    // Group 2: Foundation objects (no dependencies)
    { pattern: /^add server\s/, commands: [] },
    { pattern: /^add lb monitor\s/, commands: [] },
    { pattern: /^add ssl cipher\s/, commands: [] },
    { pattern: /^bind ssl cipher\s/, commands: [] },
    { pattern: /^add ssl certKey\s/, commands: [] },

    // Group 2.5: Stream/limit selectors (before limit identifiers and vservers)
    { pattern: /^add stream selector\s/, commands: [] },
    { pattern: /^add ns limitIdentifier\s/, commands: [] },
    { pattern: /^add ns limitSelector\s/, commands: [] },

    // Group 3: Service objects
    { pattern: /^add serviceGroup\s/, commands: [] },
    { pattern: /^add service\s(?!Group)/, commands: [] },

    // Group 4: GSLB Services (depend on sites + servers)
    { pattern: /^add gslb service\s/, commands: [] },

    // Group 5: Service bindings
    { pattern: /^bind serviceGroup\s/, commands: [] },
    { pattern: /^bind service\s(?!Group)/, commands: [] },

    // Group 6: Virtual servers
    { pattern: /^add lb vserver\s/, commands: [] },
    { pattern: /^add cs vserver\s/, commands: [] },
    { pattern: /^add gslb vserver\s/, commands: [] },

    // Group 7: Actions (must come before policies that reference them)
    { pattern: /^add cs action\s/, commands: [] },
    { pattern: /^add responder action\s/, commands: [] },
    { pattern: /^add rewrite action\s/, commands: [] },
    { pattern: /^add audit (syslog|nslog)Action\s/, commands: [] },
    { pattern: /^add cache (contentGroup|selector)\s/, commands: [] },
    { pattern: /^add spillover action\s/, commands: [] },

    // Group 8: Policies (reference actions)
    { pattern: /^add cs policy\s/, commands: [] },
    { pattern: /^add responder policy\s/, commands: [] },
    { pattern: /^add rewrite policy\s/, commands: [] },
    { pattern: /^add cmp policy\s/, commands: [] },
    { pattern: /^add cache policy\s/, commands: [] },
    { pattern: /^add authorization policy\s/, commands: [] },
    { pattern: /^add audit (syslog|nslog)Policy\s/, commands: [] },
    { pattern: /^add spillover policy\s/, commands: [] },

    // Group 9: Virtual server bindings
    { pattern: /^bind lb vserver\s/, commands: [] },
    { pattern: /^bind cs vserver\s/, commands: [] },
    { pattern: /^bind ssl (vserver|service|serviceGroup)\s/, commands: [] },
    { pattern: /^bind gslb vserver\s/, commands: [] },

    // Group 10: Modifications
    { pattern: /^set\s/, commands: [] },
    { pattern: /^link\s/, commands: [] },

    // Group 11: Final state changes
    { pattern: /^(enable|disable)\s/, commands: [] },
  ];

  // Comments and unmatched lines
  const comments: string[] = [];
  const unmatched: string[] = [];

  // Categorize each line
  for (const line of lines) {
    const trimmed = line.trim();

    // Skip empty lines
    if (!trimmed) continue;

    // Preserve comments
    if (trimmed.startsWith('#')) {
      comments.push(line);
      continue;
    }

    // Skip auto-created IP-named servers (they'll be auto-created by NetScaler)
    if (isAutoCreatedServer(trimmed)) {
      continue;
    }

    // Find matching group
    let matched = false;
    for (const group of groups) {
      if (group.pattern.test(trimmed)) {
        // Clean the command before adding (removes -devno, etc.)
        group.commands.push(cleanCommand(line));
        matched = true;
        break;
      }
    }

    // Keep unmatched lines at the end (also cleaned)
    if (!matched) {
      unmatched.push(cleanCommand(line));
    }
  }

  // Assemble output - NO comments for batch command compatibility
  const output: string[] = [];

  // Add each group (no section headers - comments break NetScaler batch)
  // Dedupe each group using Set to remove exact duplicate commands
  for (const group of groups) {
    if (group.commands.length > 0) {
      output.push(...[...new Set(group.commands)]);
    }
  }

  // Add unmatched commands at the end (also deduped)
  if (unmatched.length > 0) {
    output.push(...[...new Set(unmatched)]);
  }

  return output.join('\n');
}

/**
 * Parse configuration and return command counts by type
 */
export function analyzeConfig(config: string): Record<string, number> {
  const lines = config.split('\n').filter(l => l.trim() && !l.trim().startsWith('#'));

  const counts: Record<string, number> = {
    servers: 0,
    monitors: 0,
    serviceGroups: 0,
    services: 0,
    lbVservers: 0,
    csVservers: 0,
    gslbSites: 0,
    gslbServices: 0,
    gslbVservers: 0,
    sslCertKeys: 0,
    bindings: 0,
    policies: 0,
    other: 0,
  };

  for (const line of lines) {
    const trimmed = line.trim();

    if (/^add server\s/.test(trimmed)) counts.servers++;
    else if (/^add lb monitor\s/.test(trimmed)) counts.monitors++;
    else if (/^add serviceGroup\s/.test(trimmed)) counts.serviceGroups++;
    else if (/^add service\s(?!Group)/.test(trimmed)) counts.services++;
    else if (/^add lb vserver\s/.test(trimmed)) counts.lbVservers++;
    else if (/^add cs vserver\s/.test(trimmed)) counts.csVservers++;
    else if (/^add gslb site\s/.test(trimmed)) counts.gslbSites++;
    else if (/^add gslb service\s/.test(trimmed)) counts.gslbServices++;
    else if (/^add gslb vserver\s/.test(trimmed)) counts.gslbVservers++;
    else if (/^add ssl certKey\s/.test(trimmed)) counts.sslCertKeys++;
    else if (/^bind\s/.test(trimmed)) counts.bindings++;
    else if (/^add (cs|responder|rewrite) (policy|action)\s/.test(trimmed)) counts.policies++;
    else counts.other++;
  }

  return counts;
}
