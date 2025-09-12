const path = require('path');
const AutoLaunch = require('auto-launch');
const { exec } = require('child_process');
const { app, BrowserWindow, globalShortcut, screen, Tray, Menu, clipboard } = require('electron');
if (require('electron-squirrel-startup')) app?.quit?.();

let win;
let tray;
let isAnimating = false;
const isPackaged = app.isPackaged;
const iconPath = path.join(__dirname, 'icons/icon.ico');

const autoLauncher = new AutoLaunch({ name: 'copilot-toggle', path: app?.getPath('exe') });
if (!isPackaged) autoLauncher.disable();

const createWindow = () => {
	const { width, height } = screen.getPrimaryDisplay().workAreaSize;

	win = new BrowserWindow({
		title: 'Copilot Toggle',
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

	win.loadURL('https://copilot.microsoft.com/chats');

	win.on('close', event => {
		if (!app?.isQuitting) {
			event.preventDefault();
			win.hide();
		}
		return false;
	});

	win.on('closed', () => (win = null));
};

const fadeIn = window => {
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
};

const fadeOut = window => {
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
};

const toggleWindow = () => {
	win.isVisible() ? fadeOut(win) : (fadeIn(win), win.focus());
};

const createTray = async () => {
	tray = new Tray(iconPath);
	const isAutoLaunchEnabled = await autoLauncher.isEnabled();

	const contextMenu = Menu.buildFromTemplate([
		{ label: 'Show/Hide Copilot', click: toggleWindow },
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
				if (!!app) app.isQuitting = true;
				app?.quit();
			},
		},
	]);

	tray.setToolTip('Copilot Assistant');
	tray.setContextMenu(contextMenu);
	tray.on('click', toggleWindow);
};

const askAI = (promptPrefix, enter = true) => {
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
			win.isVisible() ? win.focus() : toggleWindow();
			setTimeout(() => {
				win.webContents.focus();
				win.webContents.send('ask', { value: promptText, enter });
			}, 100);
		}, 150);
	});
};

app?.on('ready', async () => {
	createWindow();
	await createTray();

	const toggleShortcut = globalShortcut.register('Alt+C', toggleWindow);
	if (!toggleShortcut) console.log('Alt+C registration failed');

	const rephraseShortcut = globalShortcut.register('Alt+R', () => askAI(`Rephrase in Regular, Formal and Detailed versions`));
	if (!rephraseShortcut) console.log('Alt+R registration failed');

	const grammarShortcut = globalShortcut.register('Alt+G', () => askAI(`Spot any grammar mistakes and share the lesson`));
	if (!grammarShortcut) console.log('Alt+G registration failed');

	const persianShortcut = globalShortcut.register('Alt+L', () => askAI(`Translate to Persian and identify critical vocab for learning`));
	if (!persianShortcut) console.log('Alt+L registration failed');

	const clipboardShortcut = globalShortcut.register('Alt+M', () => askAI(`From Clipboard`, false));
	if (!clipboardShortcut) console.log('Alt+M registration failed');
});

app?.on('before-quit', () => {
	if (!!app) app.isQuitting = true;
});

app?.on('window-all-closed', () => {
	if (process.platform !== 'darwin') app?.quit();
});

app?.on('activate', () => {
	if (!BrowserWindow.getAllWindows().length) createWindow();
});
