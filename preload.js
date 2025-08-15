const { ipcRenderer } = require('electron');

ipcRenderer.on('ask', (_, { value }) => {
	const input = document.querySelector('#userInput');
	if (!input) return;
	input.value = value;
	input.dispatchEvent(new Event('input', { bubbles: true }));

	const btn = document.querySelector('button[aria-label="Submit message"]');
	if (btn) btn.click();
});
