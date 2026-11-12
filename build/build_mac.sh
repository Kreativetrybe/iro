#!/bin/bash
# Builds the free Mac installer: dist/<Name>-<version>.pkg, plus an uninstaller next to it.
# Name, plugin id and version come from plugin/product.json.
#
# It is unsigned unless these are set (needs a $99/year Apple Developer account; optional):
#   SIGN_ID="Developer ID Installer: Your Name (TEAMID)"
#   NOTARY_PROFILE=<name saved with: xcrun notarytool store-credentials>
# Unsigned is fine for a free release: people allow it once in System Settings (see INSTALL.md).
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$PWD"
PRODUCT="$ROOT/plugin/product.json"
get() { plutil -extract "$1" raw -o - "$PRODUCT" 2>/dev/null || true; }
NAME="$(get name)"; ID="$(get id)"; VERSION="$(get version)"; SUPPORT="$(get supportEmail)"; SITE="$(get website)"
[ -n "$NAME" ] && [ -n "$ID" ] && [ -n "$VERSION" ] || { echo "plugin/product.json needs name, id and version."; exit 1; }
HELP="${SUPPORT:-$SITE}"
DEST="/Library/Application Support/Blackmagic Design/DaVinci Resolve/Workflow Integration Plugins/$ID"

WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
STAGE="$WORK/root"; RES="$WORK/resources"; SCRIPTS="$WORK/scripts"
mkdir -p "$STAGE" "$RES" "$SCRIPTS" "$ROOT/dist"

# The panel, without Blackmagic's binary (the installer copies it from the user's Resolve).
rsync -a --exclude '.DS_Store' --exclude 'WorkflowIntegration.node' "$ROOT/plugin/" "$STAGE/"
xattr -cr "$STAGE"  # no ._ files in the package
export COPYFILE_DISABLE=1
sed -i '' "s#<Id>.*</Id>#<Id>$ID</Id>#; s#<Version>.*</Version>#<Version>$VERSION</Version>#; s#<Name>.*</Name>#<Name>$NAME</Name>#" "$STAGE/manifest.xml"
sed -i '' "s#\"version\": \".*\"#\"version\": \"$VERSION\"#" "$STAGE/package.json"
if command -v node >/dev/null; then for f in "$STAGE"/*.js "$STAGE"/engine/*.js; do node --check "$f"; done; fi

fill() { sed -e "s#@NAME@#$NAME#g; s#@ID@#$ID#g; s#@VERSION@#$VERSION#g; s#@HELP@#$HELP#g" "$1" > "$2"; }
for f in welcome.html conclusion.html LICENSE.txt; do fill "build/mac/resources/$f" "$RES/$f"; done
cp build/mac/resources/background.png build/mac/resources/background-dark.png "$RES/"  # the logo, bottom left
fill build/mac/distribution.xml "$WORK/distribution.xml"
fill build/mac/scripts/postinstall "$SCRIPTS/postinstall"; chmod +x "$SCRIPTS/postinstall"

pkgbuild --quiet --root "$STAGE" --identifier "$ID.pkg" --version "$VERSION" \
    --install-location "$DEST" --scripts "$SCRIPTS" "$WORK/component.pkg"

OUT="$ROOT/dist/${NAME// /-}-$VERSION.pkg"
SIGN=()
[ -n "${SIGN_ID:-}" ] && SIGN=(--sign "$SIGN_ID")
productbuild --quiet --distribution "$WORK/distribution.xml" --resources "$RES" --package-path "$WORK" ${SIGN[@]+"${SIGN[@]}"} "$OUT"

if [ -n "${SIGN_ID:-}" ] && [ -n "${NOTARY_PROFILE:-}" ]; then
    xcrun notarytool submit "$OUT" --keychain-profile "$NOTARY_PROFILE" --wait
    xcrun stapler staple "$OUT"
    echo "Signed and notarized."
else
    echo "Unsigned: on first open, people allow it in System Settings › Privacy & Security (INSTALL.md)."
fi

fill build/mac/resources/LICENSE.txt "$ROOT/dist/LICENSE.txt"  # for the download page and the Windows installer
fill build/mac/uninstall.command "$ROOT/dist/Uninstall ${NAME}.command"; chmod +x "$ROOT/dist/Uninstall ${NAME}.command"
echo "Built $OUT"

# The download: one zip holding the installer, licence, install steps and uninstaller.
BASE="${NAME// /-}-$VERSION"
PACK="$WORK/$BASE"; mkdir -p "$PACK"
cp "$OUT" "$PACK/"
cp "$ROOT/dist/LICENSE.txt" "$PACK/Licence.txt"
fill build/mac/how_to_install.txt "$PACK/How to install.txt"
cp "$ROOT/dist/Uninstall ${NAME}.command" "$PACK/"
xattr -cr "$PACK"
rm -f "$ROOT/dist/$BASE-mac.zip"
ditto -c -k --norsrc --noextattr --keepParent "$PACK" "$ROOT/dist/$BASE-mac.zip"
echo "Built $ROOT/dist/$BASE-mac.zip (upload this one)"
