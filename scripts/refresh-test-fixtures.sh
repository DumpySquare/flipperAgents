#!/bin/bash
# scripts/refresh-test-fixtures.sh

set -e

FIXTURE_DIR="tests/fixtures"
QKVIEW_FILE="$FIXTURE_DIR/corkscrewTestData.qkview"
VERSION_FILE="$FIXTURE_DIR/.qkview-version"
UPSTREAM_URL="https://github.com/f5devcentral/f5-corkscrew/releases/latest/download/corkscrewTestData.qkview"

# Get latest release version from GitHub API
LATEST_VERSION=$(curl -s https://api.github.com/repos/f5devcentral/f5-corkscrew/releases/latest | jq -r .tag_name)

# Check current version
if [ -f "$VERSION_FILE" ]; then
  CURRENT_VERSION=$(jq -r .version "$VERSION_FILE")
else
  CURRENT_VERSION="none"
fi

echo "Current version: $CURRENT_VERSION"
echo "Latest version:  $LATEST_VERSION"

if [ "$CURRENT_VERSION" = "$LATEST_VERSION" ]; then
  echo "Already up to date."
  exit 0
fi

echo "Downloading new version..."
mkdir -p "$FIXTURE_DIR"
curl -L -o "$QKVIEW_FILE" "$UPSTREAM_URL"

# Calculate SHA256
SHA256=$(sha256sum "$QKVIEW_FILE" | cut -d' ' -f1)

# Update version file
cat > "$VERSION_FILE" << EOF
{
  "source": "https://github.com/f5devcentral/f5-corkscrew/releases/download/$LATEST_VERSION/corkscrewTestData.qkview",
  "version": "$LATEST_VERSION",
  "downloaded_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "sha256": "$SHA256"
}
EOF

echo ""
echo "Updated to $LATEST_VERSION"
echo "SHA256: $SHA256"
echo ""
echo "Don't forget to commit the changes!"
