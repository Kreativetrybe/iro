const { contextBridge, ipcRenderer } = require('electron/renderer');

contextBridge.exposeInMainWorld('sfx', {
    platform: process.platform,
    loadIndex: () => ipcRenderer.invoke('sfx:loadIndex'),
    loadPrefs: () => ipcRenderer.invoke('sfx:loadPrefs'),
    savePrefs: (prefs) => ipcRenderer.invoke('sfx:savePrefs', prefs),
    saveOverrides: (overrides) => ipcRenderer.invoke('sfx:saveOverrides', overrides),
    rescan: () => ipcRenderer.invoke('sfx:rescan'),
    addFolders: () => ipcRenderer.invoke('sfx:addFolders'),
    removeFolder: (folder) => ipcRenderer.invoke('sfx:removeFolder', folder),
    progress: () => ipcRenderer.invoke('sfx:progress'),
    startDrag: (file) => ipcRenderer.send('sfx:startDrag', file),
    reveal: (file) => ipcRenderer.invoke('sfx:reveal', file),
    peaks: (file) => ipcRenderer.invoke('sfx:peaks', file),
    makeSection: (file, from, to) => ipcRenderer.invoke('sfx:makeSection', file, from, to),
    placeAtPlayhead: (file, track, seconds, range) => ipcRenderer.invoke('resolve:placeAtPlayhead', file, track, seconds, range),
    audioTracks: () => ipcRenderer.invoke('resolve:audioTracks'),
    musicUnderPlayhead: () => ipcRenderer.invoke('resolve:musicUnderPlayhead'),
    musicKey: (clip) => ipcRenderer.invoke('resolve:musicKey', clip),
    setOnTop: (on) => ipcRenderer.invoke('sfx:setOnTop', on),
    about: () => ipcRenderer.invoke('app:about'),
    open: (which) => ipcRenderer.invoke('app:open', which),
});
