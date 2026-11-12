#!/bin/bash
# Removes @NAME@ from DaVinci Resolve. Your sounds are not touched. Your library index and
# favourites stay in ~/Library/Application Support/@NAME@ unless you add --all.
DEST="/Library/Application Support/Blackmagic Design/DaVinci Resolve/Workflow Integration Plugins/@ID@"
echo "Removing @NAME@ from DaVinci Resolve (your Mac password is needed)."
sudo rm -rf "$DEST" && sudo pkgutil --forget @ID@.pkg >/dev/null 2>&1
if [ "$1" = "--all" ]; then rm -rf "$HOME/Library/Application Support/@NAME@"; echo "Settings and index removed."; fi
echo "Done. Restart DaVinci Resolve."
