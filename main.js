const fs = require('fs');
const path = require('path');
const util = require('util');
const { exec } = require('child_process');
const AutoLaunch = require('auto-launch');
const { app, BrowserWindow, globalShortcut, screen, Tray, Menu, clipboard } = require('electron');
const execAsync = util.promisify(exec);

// --- Configuration & Constants ---
if (require('electron-squirrel-startup')) app?.quit();

const ASSETS = {
	icon: path.join(__dirname, 'icons/icon.ico'),
	config: path.join(app.getPath('userData'), 'assistant-config.json'),
};

const URLS = {
	Gemini: 'https://gemini.google.com',
	Copilot: 'https://copilot.microsoft.com',
	Perplexity: 'https://perplexity.ai',
};

const autoLauncher = new AutoLaunch({ name: 'AI-Toggle', path: app.getPath('exe') });
if (!app.isPackaged) autoLauncher.disable();

// --- State Management ---
let win = null;
let tray = null;
let isAnimating = false;

// Load/Save preference helper
const getStoredAssistant = () => {
	try {
		return JSON.parse(fs.readFileSync(ASSETS.config, 'utf8')).currentAssistant || 'Copilot';
	} catch {
		return 'Copilot';
	}
};
let currentAssistant = getStoredAssistant();

// --- Window Management ---
const createWindow = () => {
	if (win) return;
	const { width, height } = screen.getPrimaryDisplay().workAreaSize;

	win = new BrowserWindow({
		title: 'AI Assistant',
		width,
		height,
		show: false,
		frame: false,
		transparent: true,
		skipTaskbar: true,
		icon: ASSETS.icon,
		webPreferences: {
			nodeIntegration: false,
			contextIsolation: true,
			preload: path.join(__dirname, 'preload.js'),
		},
	});

	win.loadURL(URLS[currentAssistant]);

	// Handle Copilot's specific lazy-loading issues
	win.webContents.on('did-finish-load', () => {
		if (currentAssistant === 'Copilot') ensureCopilotLoaded();
	});

	win.on('close', e => {
		if (!app.isQuitting) {
			e.preventDefault();
			toggleWindow(false);
		}
	});
};

// Retry logic to ensure Copilot's DOM is ready before user interaction
const ensureCopilotLoaded = (retries = 0) => {
	if (!win || retries > 10) return;
	win.webContents
		.executeJavaScript(`!!document.getElementById('userInput')`)
		.then(loaded => {
			if (!loaded) {
				console.log(`Waiting for Copilot... (${retries})`);
				setTimeout(() => ensureCopilotLoaded(retries + 1), 1500);
			}
		})
		.catch(() => {});
};

// Smooth fade toggle
const toggleWindow = show => {
	if (!win || isAnimating) return;

	const isVisible = win.isVisible();
	const shouldShow = typeof show === 'boolean' ? show : !isVisible;

	if (shouldShow === isVisible) return;

	isAnimating = true;
	if (shouldShow) {
		win.setBounds(screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).bounds);
		win.setOpacity(0);
		win.show();
		win.focus();
	}

	// Animation loop
	let opacity = shouldShow ? 0 : 1;
	const step = shouldShow ? 0.1 : -0.1;

	const animate = setInterval(() => {
		opacity += step;
		if ((shouldShow && opacity >= 1) || (!shouldShow && opacity <= 0)) {
			clearInterval(animate);
			win.setOpacity(shouldShow ? 1 : 0);
			if (!shouldShow) win.hide();
			isAnimating = false;
		} else {
			win.setOpacity(opacity);
		}
	}, 15);
};

// --- System Tray ---
const createTray = async () => {
	tray = new Tray(ASSETS.icon);
	const contextMenu = Menu.buildFromTemplate([
		{ label: 'Toggle Assistant', click: () => toggleWindow() },
		{ type: 'separator' },
		...Object.keys(URLS).map(name => ({
			label: name,
			type: 'radio',
			checked: currentAssistant === name,
			click: () => {
				currentAssistant = name;
				fs.writeFileSync(ASSETS.config, JSON.stringify({ currentAssistant: name }));
				win.loadURL(URLS[name]);
				tray.setToolTip(`${name} Assistant`);
			},
		})),
		{ type: 'separator' },
		{
			label: 'Auto-launch',
			type: 'checkbox',
			checked: await autoLauncher.isEnabled(),
			click: item => (item.checked ? autoLauncher.enable() : autoLauncher.disable()),
		},
		{
			label: 'Quit',
			click: () => {
				app.isQuitting = true;
				app.quit();
			},
		},
	]);
	tray.setToolTip(`${currentAssistant} Assistant`);
	tray.setContextMenu(contextMenu);
	tray.on('click', () => toggleWindow());
};

// --- Logic: Ask AI ---
const askAI = async (promptPrefix, autoSubmit = true) => {
	if (process.platform !== 'win32') return console.log('Windows only feature');

	const oldClipboard = clipboard.readText();
	clipboard.writeText(''); // Clear to detect change

	try {
		// 1. Simulate Ctrl+C via PowerShell
		const script = `powershell -command "$w = New-Object -ComObject wscript.shell; $w.SendKeys('^{c}')"`;
		await execAsync(script);

		// 2. Poll clipboard for new text
		let capturedText = '';
		for (let i = 0; i < 20; i++) {
			// Wait up to 1 second
			capturedText = clipboard.readText();
			if (capturedText) break;
			await new Promise(r => setTimeout(r, 50));
		}

		// 3. Prepare payload
		toggleWindow(true);

		// If copy failed, just restore old text, don't crash
		if (!capturedText) {
			clipboard.writeText(oldClipboard);
			return;
		}

		const fullPrompt = `${promptPrefix}:\n${capturedText}`;

		// Optional: Save combined prompt to clipboard for user reference
		clipboard.writeText(fullPrompt);

		// 4. Send to Renderer
		if (win) {
			win.webContents.focus();
			win.webContents.send('ask-ai', { text: fullPrompt, submit: autoSubmit });
		}
	} catch (err) {
		console.error('Clipboard Action Failed:', err);
		clipboard.writeText(oldClipboard);
	}
};

// --- App Lifecycle ---
app.whenReady().then(async () => {
	createWindow();
	await createTray();

	// Register Shortcuts
	const shortcuts = {
		'Alt+C': () => toggleWindow(),
		'Alt+R': () => askAI('Rephrase in Native, Regular and Action Titled versions'),
		'Alt+G': () => askAI('Spot grammar mistakes and share the lesson'),
		'Alt+L': () => askAI('Translate to Persian and identify critical vocab'),
		'Alt+M': () => askAI('From Clipboard', false),
	};

	for (const [key, action] of Object.entries(shortcuts)) {
		globalShortcut.register(key, action);
	}
});

app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => {
	if (process.platform !== 'darwin') app.quit();
});
app.on('activate', () => {
	if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
