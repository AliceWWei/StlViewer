/**
 * preload：在页面和主进程之间开一个很小的口子。
 * 页面只能通过 window.desktop 调用这里列出的几个函数，拿不到 Node.js 或 ipcRenderer 本身。
 * 类型声明在 src/desktop.d.ts。
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  platform: process.platform,

  /** 弹出系统的“打开文件”对话框，选中的文件会通过 onOpenFile 发回来 */
  openFileDialog: () => ipcRenderer.invoke('desktop:open-dialog'),

  /** 菜单、命令行、双击关联文件打开模型时触发；返回取消监听的函数 */
  onOpenFile: (callback) => {
    const listener = (_event, file) => callback(file);
    ipcRenderer.on('desktop:open-file', listener);
    ipcRenderer.send('desktop:ready');
    return () => ipcRenderer.removeListener('desktop:open-file', listener);
  },

  /** 让原生菜单跟着界面语言切换 */
  setLanguage: (lang) => ipcRenderer.send('desktop:set-language', lang),
});
