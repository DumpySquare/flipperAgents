# Playbook: Upgrade HA Pair

Upgrade both units of an HA pair with minimal downtime. Upgrades standby first, fails over, then upgrades the original active.

## Variables
- `image_version`: Target TMOS version (e.g., "17.1.1.3-0.0.5")
- `image_file`: ISO filename on local system

## Pre-checks
- [ ] get_device_info: Verify device connectivity and current version
- [ ] get_ha_status: Confirm HA pair is in sync
  - expect: sync_status == "In Sync"
  - expect: failover_state in ["active", "standby"]
- [ ] capture_baseline: Record current VIP/pool stats
  - params: { "include": ["virtuals", "pools", "nodes"] }

## Phase 1: Backup
- [ ] create_ucs: Create pre-upgrade backup on active
  - params: { "name": "pre-upgrade-{{timestamp}}", "passphrase": "{{ucs_passphrase}}" }
- [ ] download_ucs: Download backup locally
  - params: { "name": "pre-upgrade-{{timestamp}}.ucs" }
- [ ] create_ucs: Create pre-upgrade backup on standby
  - target: "{{peer}}"
  - params: { "name": "pre-upgrade-{{timestamp}}" }

## Phase 2: Standby Upgrade
- [ ] upload_image: Upload ISO to standby
  - target: "{{peer}}"
  - params: { "file": "{{image_file}}" }
- [ ] list_images: Verify image uploaded
  - target: "{{peer}}"
- [ ] install_image: Install on standby (will reboot)
  - target: "{{peer}}"
  - params: { "volume": "HD1.2", "reboot": true }
- [ ] wait: 300
  - description: "Wait 5 minutes for standby reboot"
- [ ] check_connection: Verify standby is back online
  - target: "{{peer}}"
  - retries: 10
  - retry_delay: 30
- [ ] get_device_info: Confirm new version on standby
  - target: "{{peer}}"
  - expect: version == "{{image_version}}"
- [ ] get_ha_status: Verify HA reconnected
  - expect: peer_state == "standby"

## Phase 3: Failover
- [ ] capture_baseline: Pre-failover stats snapshot
  - params: { "label": "pre-failover" }
- [ ] sync_config: Final config sync before failover
- [ ] force_failover: Failover to upgraded standby
  - confirm: true
- [ ] wait: 30
  - description: "Allow failover to complete"
- [ ] get_ha_status: Confirm failover successful
  - expect: failover_state == "standby"
- [ ] capture_baseline: Post-failover stats
  - params: { "label": "post-failover", "compare": "pre-failover" }

## Phase 4: Original Active Upgrade
- [ ] upload_image: Upload ISO to original active (now standby)
  - params: { "file": "{{image_file}}" }
- [ ] install_image: Install on original active
  - params: { "volume": "HD1.2", "reboot": true }
- [ ] wait: 300
  - description: "Wait 5 minutes for reboot"
- [ ] check_connection: Verify device is back
  - retries: 10
  - retry_delay: 30
- [ ] get_device_info: Confirm new version
  - expect: version == "{{image_version}}"

## Post-checks
- [ ] get_ha_status: Confirm both units healthy and in sync
  - expect: sync_status == "In Sync"
  - expect: peer_version == "{{image_version}}"
- [ ] capture_baseline: Final stats comparison
  - params: { "label": "post-upgrade", "compare": "pre-failover" }
- [ ] get_virtual_stats: Verify all VIPs available
  - expect: all_available == true

## Rollback (manual)

> Only execute this section if upgrade fails and rollback is needed.

- [ ] restore_ucs: Restore from pre-upgrade backup
  - params: { "name": "pre-upgrade-{{timestamp}}.ucs", "passphrase": "{{ucs_passphrase}}" }
- [ ] reboot_device: Reboot to apply restored config
- [ ] get_ha_status: Verify HA status after rollback

---

## Notes

- Total expected downtime: ~30 seconds during failover
- Ensure maintenance window is scheduled
- Verify iHealth report for target version compatibility
- Test failover in non-prod first
