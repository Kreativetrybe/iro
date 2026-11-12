<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="brand/logo/png/iro-mark-cream.png">
    <img src="brand/logo/png/iro-mark-navy.png" alt="IRO" width="220">
  </picture>
</p>

# IRO for DaVinci Resolve Studio

Your sound effect library, sorted into categories, inside Resolve. Search, preview, find sounds in the key of your music, and drag them onto the timeline or double-click to drop them at the playhead.

*Iró* is a Yoruba word. IRO is free for everyone, for personal and paid work. If it saves you time, there is a Donate button in the panel.

Nothing else needs installing: sorting, waveforms, sections and key detection run inside the panel (`plugin/engine/`), on Resolve's own Electron. Your sounds stay where they are, and nothing is uploaded.

## Download
Get the latest Mac installer from [Releases](../../releases/latest) and follow [INSTALL.md](INSTALL.md). You need **DaVinci Resolve Studio 18 or later**: workflow integration panels are a Studio feature. Windows: `build/windows/iro.iss` (not tested yet).

## Building from source
- **Installer:** `build/build_mac.sh` builds `dist/IRO-<version>.pkg` and the download zip `dist/IRO-<version>-mac.zip`.
- **Developing:** `./install.sh` copies `plugin/` into Resolve under the id in `plugin/product.json`. Restart Resolve the first time; after that, close and reopen the panel to load a new version.
- Resolve's `WorkflowIntegration.node` is Blackmagic's file and is not in this repository: the installer and `install.sh` copy it from your own Resolve install.

Then open **Workspace › Workflow Integrations** and pick the panel. Workflow integration panels need Resolve **Studio**. Tested in Resolve Studio 21.1.1 on macOS.

## Name, links and donations
`plugin/product.json` sets the name, plugin id, version, Donate link, website and help email. The footer's **♥ Donate** button (**About** until a donate link is set) opens a card with the version and those links. Nothing is locked.

## Full screen
With **On top** ticked, the panel floats over Resolve in macOS full screen and on every Space. It also floats over other apps, so untick it, or minimize the panel, when you want it out of the way. Reopen the panel after unticking for the change to fully apply. Keyboard shortcuts go to whichever is active, so after typing in the panel, click the timeline before pressing Space or other Resolve shortcuts.

## Library folders
- **First time:** the panel opens on *Choose your sound folders*. Pick one or more folders and it sorts them (about 150 sounds a second), then you are in.
- **New downloads:** click **+ Add** next to *Folders* in the sidebar and pick the folder. Only the new sounds are sorted, and they appear in the categories and in the Folders tree. Adding a folder that is already inside your library does nothing; adding a folder that contains library folders replaces them.
- **Remove:** right-click a library folder › *Remove from library*. The files stay in Finder.
- **External drives:** if a folder's drive is not plugged in, it shows as *(not connected)* and its sounds stay in the library, coming back when the drive does. Nothing is re-sorted.
- **Rescan** picks up files added to or changed in folders already in the library. When nothing changed it finishes in under a second.

The folder list is kept in `~/Library/Application Support/IRO/config.json`.

## Using it
- Click a sound, or move with the arrow keys, to preview it. Space plays or stops. Click the waveform to play from that point.
- **Double-click** or **Enter** places the sound at the playhead. **Auto** track picks a track named SFX or FX, then any free track below A1, and adds a new track if all are busy.
- **Drag** a row onto the timeline to place it anywhere.
- **Recent searches:** click the search box to see your last 5 searches, and click one to run it again. Arrow keys and Enter work too, typing narrows the list, and × removes one. A search is saved once you pause or use a result, and only if it found something.
- **Sections:** the selected sound opens in the editor under the list. Drag across its waveform to pick just a part, drag an edge to adjust it, click to play from a point. While a section is set, Play, double-click, Enter and both drags use only that part. Double-click and Enter place a trimmed clip of the original file, so you can still pull the clip's edges out in Resolve. Dragging uses a short copy of the section (with 5 ms fades so it does not click), written to `~/Library/Application Support/IRO/sections/`. Clear, or right-click › Clear section, goes back to the whole sound.
- **F** or the star adds a favourite. **★ Favourites** at the top of the list shows only your favourites in the category you are in, and stays on as you switch categories; the sidebar counts then show how many favourites each category has. **Recently used** lists what you placed.
- **Key** filter at the top of the list: *Fits the music* (after Read music key) shows only sounds whose key or note fits it, *No clash* also keeps sounds with no clear pitch, *Has a key or note* shows every pitched sound, and any of the 24 keys can be picked by hand. Sidebar counts follow the filter.
- **Folders** at the bottom of the sidebar mirror your library as it is in Finder: each library folder, the packs inside it, and their subfolders (Left, Center and Right stereo folders are folded into their parent). Click the arrow to open a folder, click its name to list everything inside it. Search, favourites, length and key filters work there too, and folders with no matches hide while a filter is on.
- Drag the **edge between the sidebar and the list** to widen the sidebar for long pack names. When the list gets narrow, waveforms shrink and then hide so names stay readable.
- **Right-click** › Move to category fixes a wrong category. Your choice is kept across rescans.
- **Your own categories:** click **+ New** next to *My categories* in the sidebar, or right-click a sound › Move to category › *+ New category…* to make one and move the sound into it in one go. Right-click one of your categories to rename or delete it. Deleting it sends its sounds back to the category IRO sorted them into; no files are touched. They are kept in `prefs.json`.
- **Needs review** lists sounds the sorter was unsure about.
- **Read music key** reads the key of the music under the playhead, from the part of the clip you used. Green key tags fit the music, or the key picked in the Key filter.

## How sorting works
`plugin/engine/analyse.js` reads each file once (the first 40 s of long ones), in hidden worker windows that run side by side.
- Words in the filename and its folders decide the category first.
- When the name says nothing, the sound's shape decides: risers swell to the end, ambience is long and steady, ticks and clicks are short. Whooshes, swooshes and impacts are only trusted from names, because from shape alone a drill looks like a whoosh.
- When a name matches two categories equally, the one that names a kind of sound wins (Risers, Impacts, Whooshes before Glitches or Ambience).
- Key detection names a key or a single note only when the sound is clearly pitched. A note written in the filename (`G#6`, `(A#_Bb)`) wins when the audio agrees.

Data lives in `~/Library/Application Support/IRO/` (`%APPDATA%\IRO` on Windows): `index.json`, `overrides.json` (your category moves), `prefs.json` (favourites, recents, settings).

## Licence
Free to use, with the source open to read. You may not sell IRO, include it in a paid product, or release it under another name. The IRO name and logo are not licensed for other uses. The full terms are in [LICENSE](LICENSE).

IRO is not made, endorsed or supported by Blackmagic Design. DaVinci Resolve is a trademark of Blackmagic Design.
