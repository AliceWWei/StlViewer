/**
 * Electron 桌面版通过 preload（electron/preload.cjs）注入的 API。
 * 网页版里没有 window.desktop，所以使用前都要先判断它是否存在。
 */
export interface DesktopFile {
  name: string;
  data: Uint8Array;
}

export interface DesktopApi {
  platform: string;
  openFileDialog(): Promise<void>;
  onOpenFile(callback: (file: DesktopFile) => void): () => void;
  setLanguage(lang: 'zh' | 'en'): void;
}

declare global {
  interface Window {
    desktop?: DesktopApi;
  }
}
