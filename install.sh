#!/bin/bash
# Developer install of IRO into DaVinci Resolve Studio (macOS), straight from plugin/.
# It installs under the id in plugin/product.json and never touches panels with other ids.
# People downloading IRO use the installer from build/build_mac.sh instead.
# Close and reopen the panel to load a new version (restart Resolve the first time).
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
get() { plutil -extract "$1" raw -o - "$HERE/plugin/product.json"; }
ID="$(get id)"; NAME="$(get name)"
RESOLVE="/Library/Application Support/Blackmagic Design/DaVinci Resolve"
DEST="$RESOLVE/Workflow Integration Plugins/$ID"
NODE="$RESOLVE/Developer/Workflow Integrations/Examples/SamplePlugin/WorkflowIntegration.node"

[ -f "$NODE" ] || { echo "Resolve's WorkflowIntegration.node was not found. Is DaVinci Resolve Studio installed?"; exit 1; }
[ "$ID" != "com.thiseniola.sfxbrowser" ] || { echo "That id belongs to another copy of this panel. Use IRO's own id in plugin/product.json."; exit 1; }

mkdir -p "$DEST"
rsync -a --delete --exclude '.DS_Store' --exclude 'WorkflowIntegration.node' "$HERE/plugin/" "$DEST/"
sed -i '' "s#<Id>.*</Id>#<Id>$ID</Id>#; s#<Name>.*</Name>#<Name>$NAME</Name>#" "$DEST/manifest.xml"
# Overwriting this binary while an open panel has it loaded makes macOS kill the panel,
# so only copy it when it changed (a Resolve update).
cmp -s "$NODE" "$DEST/WorkflowIntegration.node" || cp "$NODE" "$DEST/"

echo "Installed to: $DEST"
echo "Restart Resolve the first time, then open Workspace > Workflow Integrations > $NAME."
