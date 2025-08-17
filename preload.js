const { ipcRenderer } = require('electron');

ipcRenderer.on('ask', (_, { value, enter = true }) => {
	const input = document.querySelector('#userInput');
	if (!input) return;
	input.value = value;
	input.dispatchEvent(new Event('input', { bubbles: true }));

	if (enter) {
		const btn = document.querySelector('button[aria-label="Submit message"]');
		if (btn) btn.click();
	}
});
