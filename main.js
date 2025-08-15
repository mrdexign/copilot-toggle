if (require('electron-squirrel-startup')) app?.quit?.();

const path = require('path');
const AutoLaunch = require('auto-launch');
const { exec } = require('child_process');
const { app, BrowserWindow, globalShortcut, screen, Tray, Menu, clipboard } = require('electron');

let win;
let tray;
let isAnimating = false;
const iconPath = path.join(__dirname, 'icons/icon.ico');

const autoLauncher = new AutoLaunch({ name: 'Copilot Assistant', path: app?.getPath('exe') });
if (process.env.NODE_ENV !== 'production') autoLauncher.disable();

function createWindow() {
	const primaryDisplay = screen.getPrimaryDisplay();
	const { width, height } = primaryDisplay.workAreaSize;

	win = new BrowserWindow({
		width: width,
		height: height,
		x: 0,
		y: 0,
		frame: false,
		show: false,
		transparent: true,
		skipTaskbar: true,
		icon: iconPath,
		webPreferences: {
			preload: path.join(__dirname, 'preload.js'),
			webviewTag: true,
			nodeIntegration: false,
			contextIsolation: true,
		},
	});

	win.loadURL('https://copilot.microsoft.com/chats');

	win.on('close', event => {
		if (!app?.isQuitting) {
			event.preventDefault();
			win.hide();
		}
		return false;
	});

	win.on('closed', () => {
		win = null;
	});
}

function fadeIn(window) {
	if (isAnimating || window.isVisible()) return;
	isAnimating = true;

	const currentScreen = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
	window.setBounds(currentScreen.bounds);
	window.setOpacity(0);
	window.show();

	let opacity = 0;
	const interval = setInterval(() => {
		opacity += 0.1;
		if (opacity >= 1) {
			window.setOpacity(1);
			clearInterval(interval);
			isAnimating = false;
		} else {
			window.setOpacity(opacity);
		}
	}, 15);
}

function fadeOut(window) {
	if (isAnimating || !window.isVisible()) return;
	isAnimating = true;

	let opacity = 1;
	const interval = setInterval(() => {
		opacity -= 0.1;
		if (opacity <= 0) {
			window.setOpacity(0);
			window.hide();
			clearInterval(interval);
			isAnimating = false;
		} else {
			window.setOpacity(opacity);
		}
	}, 15);
}

function toggleWindow() {
	if (win.isVisible()) {
		fadeOut(win);
	} else {
		fadeIn(win);
		win.focus();
	}
}

async function createTray() {
	tray = new Tray(iconPath);

	const isAutoLaunchEnabled = await autoLauncher.isEnabled();

	const contextMenu = Menu.buildFromTemplate([
		{ label: 'Show/Hide Copilot', click: toggleWindow },
		{ type: 'separator' },
		{
			label: 'Auto-launch on startup',
			type: 'checkbox',
			checked: isAutoLaunchEnabled,
			click: menuItem => {
				menuItem.checked ? autoLauncher.enable() : autoLauncher.disable();
			},
		},
		{ type: 'separator' },
		{
			label: 'Quit',
			click: () => {
				app.isQuitting = true;
				app?.quit();
			},
		},
	]);

	tray.setToolTip('Copilot Assistant');
	tray.setContextMenu(contextMenu);

	tray.on('click', toggleWindow);
}

app?.on('ready', async () => {
	createWindow();
	await createTray();

	// Register a global shortcut to toggle the window
	const toggleShortcut = globalShortcut.register('Alt+C', toggleWindow);
	if (!toggleShortcut) console.log('Alt+C registration failed');

	// Register a global shortcut to copy, format, and paste selected text for rephrasing
	const rephraseShortcut = globalShortcut.register('Alt+R', () => askAI(`Rephrase in Short, Concise, Formal and Creative versions`));
	if (!rephraseShortcut) console.log('Alt+R registration failed');

	// Register a global shortcut to spot grammar mistakes and share the lesson for formatting
	const grammarShortcut = globalShortcut.register('Alt+G', () => askAI(`Spot any grammar mistakes and share the lesson`));
	if (!grammarShortcut) console.log('Alt+G registration failed');

	// Register a global shortcut to translate the text to Persian and identify critical vocabulary for learning
	const persianShortcut = globalShortcut.register('Alt+P', () => askAI(`Translate to Persian and identify critical vocab for learning`));
	if (!persianShortcut) console.log('Alt+P registration failed');
});

function askAI(promptPrefix) {
	if (process.platform !== 'win32') {
		console.log('Text action shortcuts are only available on Windows.');
		return;
	}

	const copyCommand = 'powershell -command "$wshell = New-Object -ComObject wscript.shell; $wshell.SendKeys(\'^{c}\')"';
	exec(copyCommand, error => {
		if (error) return console.error(`Failed to copy selected text: ${error}`);

		setTimeout(async () => {
			const selectedText = clipboard.readText();
			if (!selectedText) {
				console.log('No text was selected or the clipboard is empty.');
				return;
			}

			const promptText = `${promptPrefix}:\n${selectedText}`;
			await clipboard.writeText(promptText);

			if (!win.isVisible()) toggleWindow();
			else win.focus();

			setTimeout(() => {
				win.webContents.focus();
				win.webContents.send('ask', { value: promptText });
			}, 100);
		}, 150);
	});
}

app?.on('before-quit', () => {
	app.isQuitting = true;
});

app?.on('window-all-closed', () => {
	if (process.platform !== 'darwin') app?.quit();
});

app?.on('activate', () => {
	if (!BrowserWindow.getAllWindows().length) createWindow();
});
