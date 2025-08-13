const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
	// You can expose specific APIs here if your renderer process needs them.
	// For this application, we don't need to expose any specific APIs
	// as the main process handles the window toggling.
});
