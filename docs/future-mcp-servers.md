# Future MCP Servers

Planning document for additional MCP servers beyond NetScaler and TMOS.

## Priority

| Server | Priority | Rationale |
|--------|----------|-----------|
| F5 XC | High | Migration target for NetScaler/BIG-IP configs |
| BIG-IQ | Medium | Fleet management, licensing, AS3 deployments |
| NGINX | Low | Wait for user demand |

---

## F5 Distributed Cloud (XC)

**Package name:** `flipperagents-xc-mcp`

### Use Cases

- Migrate configurations from NetScaler or BIG-IP to XC
- Manage HTTP load balancers, origin pools, health checks
- Certificate management
- WAF policy configuration

### API Reference

- [XC API Documentation](https://docs.cloud.f5.com/docs/api)
- Authentication: API tokens or service credentials
- Base URL: `https://<tenant>.console.ves.volterra.io/api`

### Potential Tools

| Tool | Description |
|------|-------------|
| `list_load_balancers` | List HTTP/HTTPS load balancers |
| `get_load_balancer` | Get load balancer configuration |
| `list_origin_pools` | List origin pools |
| `get_origin_pool` | Get origin pool details |
| `list_health_checks` | List health check configurations |
| `list_certificates` | List TLS certificates |
| `get_namespace` | Get namespace configuration |
| `list_namespaces` | List available namespaces |

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `XC_TENANT` | Yes | XC tenant name |
| `XC_API_TOKEN` | Yes | API token for authentication |
| `XC_NAMESPACE` | No | Default namespace |

### Research Questions

- What's the best auth approach - API tokens vs service credentials?
- How are configs structured - per namespace?
- What's the migration path from AS3 declarations to XC?
- Rate limiting considerations?

---

## BIG-IQ

**Package name:** `flipperagents-bigiq-mcp`

### Use Cases

- Fleet management: view/manage multiple BIG-IP devices
- License pool management
- Deploy AS3 declarations through BIG-IQ to managed devices
- Centralized backup/restore across fleet
- Audit configurations across devices

### API Reference

- [BIG-IQ API Documentation](https://clouddocs.f5.com/products/big-iq/mgmt-api/latest/)
- Authentication: Token-based (similar to BIG-IP iControl REST)
- Base URL: `https://<bigiq>/mgmt`

### Potential Tools

| Tool | Description |
|------|-------------|
| `list_devices` | List managed BIG-IP devices |
| `get_device` | Get device details and status |
| `list_license_pools` | List license pools |
| `get_license_pool` | Get pool details and assignments |
| `assign_license` | Assign license to device |
| `revoke_license` | Revoke license from device |
| `deploy_as3` | Deploy AS3 declaration via BIG-IQ |
| `list_as3_declarations` | List deployed AS3 declarations |
| `get_as3_declaration` | Get AS3 declaration for device/tenant |
| `backup_device` | Trigger UCS backup for device |
| `list_backups` | List available device backups |

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `BIGIQ_HOST` | Yes | BIG-IQ hostname/IP |
| `BIGIQ_USER` | No | Username (default: admin) |
| `BIGIQ_PASS` | Yes | Password |

### Research Questions

- How does AS3 deployment through BIG-IQ differ from direct to BIG-IP?
- What device group/targeting options exist?
- License pool types and management workflows?
- Can we query device configurations remotely through BIG-IQ?

---

## NGINX (Deferred)

**Package name:** `flipperagents-nginx-mcp`

### Notes

- Target NGINX Open Source via SSH/config file management
- Similar approach to NetScaler SSH batch commands
- Limited API surface without NGINX Plus
- Wait for user requests before implementing

### Potential Tools (if implemented)

| Tool | Description |
|------|-------------|
| `get_config` | Get nginx.conf contents |
| `test_config` | Run nginx -t to validate |
| `reload_config` | Reload NGINX gracefully |
| `get_status` | Get NGINX process status |
| `list_upstreams` | Parse upstream blocks from config |
| `list_servers` | Parse server blocks from config |

---

## Implementation Notes

### Scaffolding Checklist

For each new MCP server:

- [ ] Create `mcp/<name>/` directory structure
- [ ] Set up `package.json` with correct name
- [ ] Wire up telemetry with unique `digitalAssetName`
- [ ] Implement basic connection/auth tool
- [ ] Add to root workspace if using workspaces
- [ ] Create README with setup instructions

### Shared Patterns

All MCP servers should follow established patterns:

- Telemetry via `@flipper/telemetry` package
- HTTP/SSE transport option for development
- Environment variable configuration
- Confirmation parameter for write operations
- Clear tool descriptions for LLM understanding
