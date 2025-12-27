const { ipcRenderer } = require('electron');

// --- Site Configuration ---
const CONFIG = {
	'copilot.microsoft.com': {
		input: ['#userInput', '.input-area textarea', 'textarea[id*="searchbox"]'],
		submit: ['button[aria-label="Submit message"]', '.send-button'],
		method: 'react-props', // Copilot uses React, requires native value setter
	},
	'gemini.google.com': {
		input: ['.ql-editor', 'div[role="textbox"]'],
		submit: ['button[aria-label*="Send"]', '.send-button'],
		method: 'rich-text', // Gemini uses a contenteditable div
	},
};

// --- Helpers ---
const getElement = selectors => {
	for (const s of selectors) {
		const el = document.querySelector(s);
		if (el) return el;
	}
	return null;
};

// Trigger React's internal state update logic
const reactInsert = (element, value) => {
	const descriptor = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value');
	const nativeSetter = descriptor?.set;
	if (nativeSetter) {
		nativeSetter.call(element, value);
		element.dispatchEvent(new Event('input', { bubbles: true }));
	} else {
		element.value = value;
	}
};

// Trigger rich text insertion
const richTextInsert = value => {
	document.execCommand('selectAll', false, null);
	document.execCommand('insertText', false, value);
};

// --- Main Listener ---
ipcRenderer.on('ask-ai', (_, { text, submit }) => {
	const host = window.location.hostname;
	const settings = CONFIG[host]; // Default to Copilot
	if (!settings) return console.warn(`Unsupported host: ${host}`);

	const inputEl = getElement(settings.input);
	if (!inputEl) return console.warn('AI Input not found');

	// 1. Focus
	inputEl.focus();
	inputEl.click();

	// 2. Insert Text based on method
	if (settings.method === 'react-props') {
		reactInsert(inputEl, text);
	} else {
		richTextInsert(text);
	}

	// 3. Submit (optional delay to allow UI to validate input)
	if (submit) {
		setTimeout(() => {
			const btn = getElement(settings.submit);
			if (btn) {
				btn.click();
			} else {
				// Fallback: Press Enter
				inputEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
			}
		}, 300);
	}
});
