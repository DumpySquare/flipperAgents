# Playbook: Convert Application to AS3

Extract a single application from TMOS config and convert to AS3 declaration.

## Variables
- `app_name`: Virtual server name (e.g., "/Common/my_app_vs")
- `output_file`: Where to save AS3 declaration

## Phase 1: Extract Config
- [ ] create_ucs: Create mini-UCS for parsing
  - params: { "mini": true }
- [ ] download_ucs: Download to local
- [ ] parse_config: Parse UCS into JSON
  - params: { "source": "{{ucs_file}}" }
- [ ] list_applications: Show all available applications
  - description: "Review available apps if unsure of exact name"

## Phase 2: Extract Application
- [ ] extract_application: Get app config with all dependencies
  - params: { "name": "{{app_name}}" }
  - output: app_config

## Phase 3: Convert to AS3
- [ ] convert_to_as3: Convert extracted config to AS3
  - params: { "config": "{{app_config}}" }
  - output: as3_declaration
- [ ] validate_as3: Validate against schema
  - params: { "declaration": "{{as3_declaration}}", "mode": "strict" }
  - on_fail: show_errors

## Phase 4: Review & Deploy (optional)
- [ ] get_as3_declaration: Get current AS3 state
  - description: "Review existing AS3 tenants"
- [ ] deploy_as3: Deploy converted declaration
  - confirm: true
  - params: { "declaration": "{{as3_declaration}}" }

---

## Notes

- Review `as3NotConverted` in conversion output for unsupported objects
- May need manual adjustment for iRules with complex logic
- Validate in non-prod environment first
