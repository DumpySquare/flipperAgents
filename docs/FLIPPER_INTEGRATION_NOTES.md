# Flipper Integration Notes

This document captures logic and patterns discovered during NetScaler MCP server development that should be incorporated into Project Flipper when abstracting configuration pieces.

## Auto-Created Server Objects

### Problem: Auto-Created Servers

When a NetScaler service references an IP address directly (instead of a named server), NetScaler automatically creates a server object where **the name equals the IP address**.

**Example:**

```text
# User creates service with direct IP
add service BANANA_SVC_8080 10.240.31.100 HTTP 8080

# NetScaler auto-creates:
add server 10.240.31.100 10.240.31.100
```

### Why This Matters

1. **Config Export Includes Auto-Created Servers**: When you run `show running`, NetScaler exports these auto-created servers explicitly.

2. **Re-deployment Fails**: If you try to deploy the exported config to the same or different NetScaler that already has data:
   - The `add server 10.240.31.100 10.240.31.100` command fails with "Resource already exists"
   - The service would have auto-created the server anyway

3. **Unnecessary Config Bloat**: These server entries add no value - they'll be recreated automatically.

### Solution for Flipper

When parsing/abstracting NetScaler configs, **ignore server entries where name == IP address**:

```typescript
// Pattern to detect auto-created servers
// IPv4: add server 10.240.31.100 10.240.31.100
// IPv6: add server 2001:db8::1 2001:db8::1

function isAutoCreatedServer(line: string): boolean {
  const ipv4Pattern = /^add server\s+(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\s+\1(\s|$)/;
  const ipv6Pattern = /^add server\s+([0-9a-fA-F:]+)\s+\1(\s|$)/;
  return ipv4Pattern.test(line) || ipv6Pattern.test(line);
}
```

### Flipper Guidance: Server Objects

When creating the universal config model in Flipper:

1. **Don't create Server objects** for IP-named servers during import
2. **Service objects can reference IPs directly** - the target platform will handle server creation as needed
3. **Named servers should be preserved** - only filter `add server <IP> <IP>` pattern

---

## Internal Options to Strip

### -devno (Device Number)

NetScaler assigns internal device numbers to objects. These should be stripped during deployment.

**Pattern:** `-devno \d+`

**Example:**

```text
# From export:
add service SVC1 server1 HTTP 80 -devno 73465856

# Should become:
add service SVC1 server1 HTTP 80
```

### Flipper Guidance: Strip -devno

Strip `-devno` during import - it's not meaningful for config abstraction.

---

## System Resources to Preserve

### System Monitors

These built-in monitors should never be deleted or modified:

```text
ping-default, tcp-default, arp, nd6, ping, tcp, http, tcp-ecv,
http-ecv, udp-ecv, dns, ftp, tcps, https, tcps-ecv, https-ecv,
xdm, xnc, mqtt, mqtt-tls, http2direct, http2ssl, ldns-ping,
ldns-tcp, ldns-dns, stasecure, sta
```

### System Certificates

Certificates with `feature === 'SYSTEM'` are system-level and should be preserved:

- `ns-server-certificate` - Default NetScaler management certificate

### Flipper Guidance: System Resources

- Don't include system monitors in abstracted configs
- Don't include system certificates in abstracted configs
- When deploying, never delete these resources

---

## SSL Certificate Handling

### Certificate References in Config

Configs reference certificates by name, but the actual cert/key files must exist on the target:

```text
add ssl certKey www.example.com -cert /nsconfig/ssl/www_example_com.cert -key /nsconfig/ssl/www_example_com.key
bind ssl vserver VS1 -certkeyName www.example.com
```

### Flipper Guidance: SSL Certificates

1. **Extract certificate references** from `add ssl certKey` commands
2. **Track cert/key file paths** for each certificate
3. **Provide mechanism** to upload actual cert content during deployment
4. **Consider**: Certificate content may need to be stored separately (secrets management)

---

## Custom Cipher Groups

### Built-in vs Custom Ciphers

NetScaler has many built-in cipher suites. Custom cipher groups need to be created before use.

**Built-in (no creation needed):**

```text
ALL, DEFAULT, kRSA, kEDH, DH, EDH, aRSA, aDSS, aNULL, DSS, DES, 3DES,
RC4, RC2, eNULL, MD5, SHA, SHA1, EXP, EXPORT, EXPORT40, EXPORT56, LOW,
MEDIUM, HIGH, RSA, NULL, ECDHE, ECDSA, AES, AES128, AES256, AESGCM,
AESCCM, ARIA128, ARIA256, CAMELLIA128, CAMELLIA256, CHACHA20
```

**Custom (must be created):**

```text
add ssl cipher TLS12ECDHE
bind ssl cipher TLS12ECDHE -cipherName TLS1.2-ECDHE-RSA-AES256-GCM-SHA384
```

### Flipper Guidance: Cipher Groups

1. **Detect custom cipher groups** (names not in built-in list)
2. **Include cipher group definitions** in abstracted config
3. **Provision cipher groups before** binding them to vservers

---

## Config Command Dependencies

Commands must be executed in dependency order. The MCP server uses this ordering:

1. **Foundation Objects** (no dependencies)
   - Servers
   - Monitors
   - SSL certificates

2. **Service Objects**
   - Service Groups
   - Services (depend on servers)

3. **Service Bindings**
   - Service Group bindings
   - Service bindings (depend on services + monitors)

4. **Virtual Servers**
   - LB vservers
   - CS vservers
   - GSLB vservers

5. **Policies**
   - CS policies/actions
   - Responder policies/actions
   - Rewrite policies/actions

6. **Virtual Server Bindings**
   - LB vserver bindings
   - CS vserver bindings
   - SSL bindings
   - GSLB bindings

7. **Modifications**
   - Set commands
   - Link commands

8. **State Changes**
   - Enable/Disable commands

### Flipper Guidance: Command Dependencies

When generating deployment configs for any platform, respect dependency ordering.

---

## Comments in Batch Commands

NetScaler's SSH batch execution does **not support comment lines** (`#`).

**This fails:**

```bash
# Create server
add server myserver 10.1.1.1
```

**This works:**

```bash
add server myserver 10.1.1.1
```

### Flipper Guidance: Comments

Strip all comments when generating deployment configs for NetScaler.

---

## CS Policy Syntax Changes (13.1+)

### Problem: CS Policy Binding Syntax

NetScaler 13.1 requires explicit CS actions for advanced content switching policies. Older configs use `-targetLBVserver` in the bind command, which fails on 13.1+.

### Old Syntax (pre-13.1)

```text
# Policy without action
add cs policy my-policy -rule "HTTP.REQ.URL.CONTAINS(\"/api\")"

# Bind with target in the bind command
bind cs vserver my-cs-vs -policyName my-policy -targetLBVserver my-backend-lb -priority 100
```

**Error on 13.1:**

```text
ERROR: Multiple Bind not supported for Content Switching Advanced policies without action
```

### New Syntax (13.1+)

```text
# 1. Create action with target
add cs action my-policy-action -targetLBVserver my-backend-lb

# 2. Policy references action
add cs policy my-policy -rule "HTTP.REQ.URL.CONTAINS(\"/api\")" -action my-policy-action

# 3. Bind without -targetLBVserver
bind cs vserver my-cs-vs -policyName my-policy -priority 100
```

### Flipper Guidance: CS Policy Transformation

When parsing NetScaler configs for Flipper:

1. **Detect legacy pattern**: `bind cs vserver ... -policyName X -targetLBVserver Y`
2. **Find the policy**: Look for `add cs policy X -rule "..."` without `-action`
3. **Transform to new syntax**:
   - Create action: `add cs action X-action -targetLBVserver Y`
   - Modify policy: add `-action X-action` to the policy
   - Modify bind: remove `-targetLBVserver Y`

### Version Detection

Config exports include version in header comment:

```text
#NS13.0 Build 86.17   <- Old syntax may be present
#NS13.1 Build 61.23   <- New syntax required
```

Use this to flag configs that may need transformation before deployment to 13.1+.

---

## Future Considerations

### Service Types with Direct IP

Both of these are valid and should be supported:

```text
# Named server reference
add server web1 10.1.1.1
add service SVC1 web1 HTTP 80

# Direct IP reference (server auto-created)
add service SVC2 10.1.1.2 HTTP 80
```

When converting between platforms, Flipper should:

1. Recognize both patterns
2. Convert to target platform's preferred format
3. Not lose information about explicit server definitions vs auto-created
