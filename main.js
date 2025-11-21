const fs = require('fs');
const path = require('path');
const AutoLaunch = require('auto-launch');
const { exec } = require('child_process');
const { app, BrowserWindow, globalShortcut, screen, Tray, Menu, clipboard } = require('electron');
if (require('electron-squirrel-startup')) app?.quit?.();

let win = null;
let tray = null;
let isAnimating = false;
const isPackaged = app.isPackaged;
const iconPath = path.join(__dirname, 'icons/icon.ico');

const autoLauncher = new AutoLaunch({ name: 'copilot-toggle', path: app?.getPath('exe') });
if (!isPackaged) autoLauncher.disable();

// Assistant URLs
const assistantUrls = {
	Copilot: 'https://copilot.microsoft.com',
	Perplexity: 'https://www.perplexity.ai',
};

// Config persistence
const configPath = path.join(app.getPath('userData'), 'assistant-config.json');
const loadAssistant = () => {
	try {
		const data = fs.readFileSync(configPath, 'utf8');
		const parsed = JSON.parse(data);
		return parsed.currentAssistant || 'Copilot';
	} catch {
		return 'Copilot';
	}
};
const saveAssistant = name => {
	fs.writeFileSync(configPath, JSON.stringify({ currentAssistant: name }));
};

let currentAssistant = loadAssistant();

const createWindow = () => {
	if (win) return;

	const { width, height } = screen.getPrimaryDisplay().workAreaSize;

	win = new BrowserWindow({
		title: 'AI Assistant',
		width,
		height,
		x: 0,
		y: 0,
		show: false,
		frame: false,
		transparent: true,
		skipTaskbar: true,
		icon: iconPath,
		webPreferences: {
			webviewTag: true,
			nodeIntegration: false,
			contextIsolation: true,
			preload: path.join(__dirname, 'preload.js'),
		},
	});

	win.loadURL(assistantUrls[currentAssistant]);

	let retryCount = 0;
	const maxRetries = 10;
	const retryInterval = 1500;

	const ensureLoaded = () => {
		if (!win || win.webContents.isLoading()) return;

		if (currentAssistant === 'Copilot') {
			// Copilot has a known input element we can check
			win.webContents
				.executeJavaScript(`!!document.getElementById('userInput')`)
				.then(isLoaded => {
					if (isLoaded) {
						console.log('Copilot is fully loaded.');
						retryCount = maxRetries;
					} else if (retryCount < maxRetries) {
						retryCount++;
						console.log(`Retrying Copilot load (${retryCount}/${maxRetries})...`);
						win.webContents.reload();
						setTimeout(ensureLoaded, retryInterval);
					} else {
						console.warn('Max retries reached. Copilot may not have loaded correctly.');
					}
				})
				.catch(err => console.error('Error checking DOM:', err));
		} else {
			// For Perplexity (or other assistants), just log once
			console.log(`${currentAssistant} finished loading (no DOM check applied).`);
			retryCount = maxRetries; // stop retry loop
		}
	};

	win.webContents.on('did-fail-load', () => {
		console.warn('Initial load failed. Starting retry loop...');
		retryCount = 0;
		setTimeout(ensureLoaded, retryInterval);
	});

	win.webContents.on('did-finish-load', () => {
		console.log('Initial load finished. Verifying DOM...');
		setTimeout(ensureLoaded, retryInterval);
	});

	win.on('close', event => {
		if (!app?.isQuitting) {
			event.preventDefault();
			win.hide();
		}
	});

	win.on('closed', () => {
		win = null;
	});
};

const fadeIn = window => {
	if (isAnimating || window.isVisible()) return;
	isAnimating = true;

	const currentScreen = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
	window.setBounds(currentScreen.bounds);
	window.setOpacity(0);
	window.show();

	let opacity = 0;
	const step = () => {
		opacity += 0.1;
		if (opacity >= 1) {
			window.setOpacity(1);
			isAnimating = false;
		} else {
			window.setOpacity(opacity);
			setTimeout(step, 15);
		}
	};
	step();
};

const fadeOut = window => {
	if (isAnimating || !window.isVisible()) return;
	isAnimating = true;

	let opacity = 1;
	const step = () => {
		opacity -= 0.1;
		if (opacity <= 0) {
			window.setOpacity(0);
			window.hide();
			isAnimating = false;
		} else {
			window.setOpacity(opacity);
			setTimeout(step, 15);
		}
	};
	step();
};

const toggleWindow = open => {
	if (!win) return;
	const isVisible = win.isVisible();
	if (typeof open === 'boolean') {
		open !== isVisible && (open ? fadeIn(win) : fadeOut(win));
	} else {
		isVisible ? fadeOut(win) : (fadeIn(win), win.focus());
	}
};

const setAssistant = name => {
	currentAssistant = name;
	saveAssistant(name);
	if (win) {
		win.loadURL(assistantUrls[name]);
	}
	tray.setToolTip(`${name} Assistant`);
};

const createTray = async () => {
	if (tray) return;
	tray = new Tray(iconPath);

	const isAutoLaunchEnabled = await autoLauncher.isEnabled();

	const contextMenu = Menu.buildFromTemplate([
		{ label: 'Show/Hide Assistant', click: toggleWindow },
		{ type: 'separator' },
		{
			label: 'Assistant',
			submenu: Object.keys(assistantUrls).map(name => ({
				label: name,
				type: 'radio',
				checked: currentAssistant === name,
				click: () => setAssistant(name),
			})),
		},
		{ type: 'separator' },
		{
			label: 'Auto-launch on startup',
			type: 'checkbox',
			checked: isAutoLaunchEnabled,
			click: menuItem => (menuItem.checked ? autoLauncher.enable() : autoLauncher.disable()),
		},
		{ type: 'separator' },
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
	tray.on('click', toggleWindow);
};

const askAI = (promptPrefix, enter = true) => {
	if (process.platform !== 'win32') {
		console.log('Text action shortcuts are only available on Windows.');
		return;
	}

	exec('powershell -command "$wshell = New-Object -ComObject wscript.shell; $wshell.SendKeys(\'^{c}\')"', error => {
		toggleWindow(true);
		if (error) return console.error(`Failed to copy selected text: ${error}`);
		setTimeout(() => {
			const selectedText = clipboard.readText();
			if (!selectedText) {
				console.log('No text was selected or the clipboard is empty.');
				return;
			}
			const promptText = `${promptPrefix}:\n${selectedText}`;
			clipboard.writeText(promptText);
			setTimeout(() => {
				win?.webContents?.focus();
				win?.webContents?.send('ask', { value: promptText, enter });
			}, 100);
		}, 150);
	});
};

app.on('ready', async () => {
	createWindow();
	await createTray();
	const shortcuts = [
		{ key: 'Alt+C', action: toggleWindow },
		{ key: 'Alt+R', action: () => askAI(`Rephrase in Regular, Formal and Detailed versions`) },
		{ key: 'Alt+G', action: () => askAI(`Spot any grammar mistakes and share the lesson`) },
		{ key: 'Alt+L', action: () => askAI(`Translate to Persian and identify critical vocab for learning`) },
		{ key: 'Alt+M', action: () => askAI(`From Clipboard`, false) },
	];
	shortcuts.forEach(({ key, action }) => {
		if (!globalShortcut.register(key, action)) console.log(`${key} registration failed`);
	});
});

app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('before-quit', () => {
	app.isQuitting = true;
});
app.on('window-all-closed', () => {
	if (process.platform !== 'darwin') app.quit();
});
app.on('activate', () => {
	if (!BrowserWindow.getAllWindows().length) createWindow();
});
