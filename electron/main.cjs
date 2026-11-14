/**
 * Electron 主进程：创建窗口、原生菜单、读取文件，再把文件内容发给页面。
 * 页面（renderer）还是同一套 React 代码，读到的字节包装成 File 后走和网页版完全相同的解析流程。
 *
 * 用 CommonJS（.cjs）写是为了不需要额外编译：package.json 是 "type": "module"，
 * 而开启 sandbox 的 preload 只能是 CommonJS。
 */
const { app, BrowserWindow, Menu, dialog, ipcMain } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');

const SUPPORTED = ['stl', 'obj', '3mf'];
/** 开发模式下由 scripts/electron-dev.mjs 传进来；打包后为空，加载 dist/index.html */
const DEV_URL = process.env.VITE_DEV_SERVER_URL;

/** @type {BrowserWindow | null} */
let win = null;
/** 页面还没准备好时收到的文件（命令行 / 双击文件启动），等页面通知 ready 后再发 */
let pendingFile = null;
let rendererReady = false;
let lang = 'en';

const MENU_TEXT = {
  en: {
    file: 'File', open: 'Open…', exit: 'Exit', view: 'View', help: 'Help', about: 'About StlViewer', filter: '3D models',
    reload: 'Reload', devTools: 'Toggle Developer Tools', resetZoom: 'Actual Size', zoomIn: 'Zoom In',
    zoomOut: 'Zoom Out', fullScreen: 'Toggle Full Screen',
  },
  zh: {
    file: '文件', open: '打开…', exit: '退出', view: '查看', help: '帮助', about: '关于 StlViewer', filter: '3D 模型',
    reload: '重新加载', devTools: '开发者工具', resetZoom: '实际大小', zoomIn: '放大',
    zoomOut: '缩小', fullScreen: '全屏',
  },
};

function isSupported(filePath) {
  return SUPPORTED.includes(path.extname(filePath).slice(1).toLowerCase());
}

/** 从命令行参数里找模型文件（双击关联文件时，Windows 会把路径作为参数传进来） */
function fileFromArgv(argv) {
  // 打包后 argv[0] 是 exe；开发时是 electron.exe 和入口脚本，跳过不存在 / 不支持的参数即可
  return argv.slice(1).find((a) => !a.startsWith('-') && isSupported(a)) ?? null;
}

async function sendFile(filePath) {
  if (!win || !rendererReady) {
    pendingFile = filePath;
    return;
  }
  try {
    const data = await fs.readFile(filePath);
    // 只把这一个文件的字节发过去，页面拿不到任意路径的读取权限
    win.webContents.send('desktop:open-file', { name: path.basename(filePath), data: new Uint8Array(data) });
  } catch (e) {
    dialog.showErrorBox('StlViewer', `${filePath}\n\n${e instanceof Error ? e.message : String(e)}`);
  }
}

async function showOpenDialog() {
  if (!win) return;
  const t = MENU_TEXT[lang];
  const result = await dialog.showOpenDialog(win, {
    properties: ['openFile'],
    filters: [{ name: `${t.filter} (*.stl, *.obj, *.3mf)`, extensions: SUPPORTED }],
  });
  if (!result.canceled && result.filePaths[0]) await sendFile(result.filePaths[0]);
}

function buildMenu() {
  const t = MENU_TEXT[lang];
  const template = [
    {
      label: t.file,
      submenu: [
        { label: t.open, accelerator: 'CmdOrCtrl+O', click: () => showOpenDialog() },
        { type: 'separator' },
        { label: t.exit, role: 'quit' },
      ],
    },
    {
      label: t.view,
      submenu: [
        { label: t.reload, role: 'reload' },
        { label: t.devTools, role: 'toggleDevTools' },
        { type: 'separator' },
        { label: t.resetZoom, role: 'resetZoom' },
        { label: t.zoomIn, role: 'zoomIn' },
        { label: t.zoomOut, role: 'zoomOut' },
        { type: 'separator' },
        { label: t.fullScreen, role: 'togglefullscreen' },
      ],
    },
    {
      label: t.help,
      submenu: [
        {
          label: t.about,
          click: () =>
            dialog.showMessageBox(win, {
              type: 'info',
              title: 'StlViewer',
              message: `StlViewer ${app.getVersion()}`,
              detail: `Electron ${process.versions.electron} · Chromium ${process.versions.chrome}`,
            }),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    title: 'StlViewer',
    backgroundColor: '#1e1f24',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  rendererReady = false;

  // 外部链接一律不在应用窗口里打开
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e, url) => {
    if (DEV_URL ? !url.startsWith(DEV_URL) : !url.startsWith('file://')) e.preventDefault();
  });

  if (DEV_URL) win.loadURL(DEV_URL);
  else win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));

  win.on('closed', () => {
    win = null;
  });
}

// ───────────────────────── IPC ─────────────────────────

ipcMain.handle('desktop:open-dialog', () => showOpenDialog());

// 页面加载好、开始监听文件以后通知一次，把启动时带的文件发过去
ipcMain.on('desktop:ready', (e) => {
  if (!win || e.sender !== win.webContents) return;
  rendererReady = true;
  if (pendingFile) {
    const f = pendingFile;
    pendingFile = null;
    sendFile(f);
  }
});

// 菜单文字跟着页面语言
ipcMain.on('desktop:set-language', (_e, l) => {
  if ((l === 'zh' || l === 'en') && l !== lang) {
    lang = l;
    buildMenu();
  }
});

// ───────────────────────── 单实例 ─────────────────────────

// 已经开着一个窗口时再双击模型文件，不开新窗口，而是交给已有窗口打开
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
    const f = fileFromArgv(argv);
    if (f) sendFile(f);
  });

  app.whenReady().then(() => {
    pendingFile = fileFromArgv(process.argv);
    buildMenu();
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
