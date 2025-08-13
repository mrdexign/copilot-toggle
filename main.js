const { app, BrowserWindow, globalShortcut, screen, Tray, Menu } = require('electron');
const path = require('path');
const AutoLaunch = require('auto-launch');

let mainWindow;
let tray;
let isDev = process.env.NODE_ENV !== 'production';

function createWindow() {
	const primaryDisplay = screen.getPrimaryDisplay();
	const { width, height } = primaryDisplay.workAreaSize;

	mainWindow = new BrowserWindow({
		width: width,
		height: height,
		x: 0,
		y: 0,
		frame: false,
		show: false,
		fullscreen: true,
		skipTaskbar: true, // Hides the app from the taskbar
		webPreferences: {
			preload: path.join(__dirname, 'preload.js'),
			webviewTag: true,
			nodeIntegration: false,
			contextIsolation: true,
		},
	});

	mainWindow.loadURL('https://copilot.microsoft.com/chats');

	// Instead of closing, hide the window
	mainWindow.on('close', event => {
		if (!app.isQuitting) {
			event.preventDefault();
			mainWindow.hide();
		}
		return false;
	});

	mainWindow.on('closed', () => {
		mainWindow = null;
	});
}

function createTray() {
	const iconPath = path.join(__dirname, 'icons/icon.ico');
	tray = new Tray(iconPath);

	const toggleWindow = () => {
		if (mainWindow.isVisible()) {
			mainWindow.hide();
		} else {
			const currentScreen = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
			mainWindow.setBounds(currentScreen.bounds);
			mainWindow.show();
		}
	};

	const contextMenu = Menu.buildFromTemplate([
		{ label: 'Show/Hide Copilot', click: toggleWindow },
		{ type: 'separator' },
		{
			label: 'Quit',
			click: () => {
				app.isQuitting = true;
				app.quit();
			},
		},
	]);

	tray.setToolTip('Copilot Assistant');
	tray.setContextMenu(contextMenu);

	// Also toggle on single click
	tray.on('click', toggleWindow);
}

app.on('ready', () => {
	createWindow();
	createTray();

	// Register a global shortcut listener.
	const ret = globalShortcut.register('Alt+C', () => {
		if (mainWindow.isVisible()) {
			mainWindow.hide();
		} else {
			const currentScreen = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
			mainWindow.setBounds(currentScreen.bounds);
			mainWindow.show();
		}
	});

	if (!ret) {
		console.log('Registration failed');
	}
});

// This event is fired before quitting the app
app.on('before-quit', () => {
	app.isQuitting = true;
});

app.on('window-all-closed', () => {
	// On macOS it is common for applications and their menu bar
	// to stay active until the user quits explicitly with Cmd + Q
	if (process.platform !== 'darwin') {
		app.quit();
	}
});

app.on('activate', () => {
	// On macOS it's common to re-create a window in the app when the
	// dock icon is clicked and there are no other windows open.
	if (BrowserWindow.getAllWindows().length === 0) {
		createWindow();
	}
});

// Auto-launch configuration
let autoLaunch = new AutoLaunch({
	name: 'Copilot Assistant',
	path: app.getPath('exe'),
});

autoLaunch.isEnabled().then(isEnabled => {
	if (!isEnabled) autoLaunch.enable();
});
