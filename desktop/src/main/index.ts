import {
  app, BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeImage, Notification, protocol, safeStorage, screen, shell, Tray, utilityProcess,
} from 'electron';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { DesktopService, type WorkerFactory } from './service';
import { StateStore, defaultState } from './state';
import { decodeCharacterImage } from './character-images';
import { characterImageFormat, characterImageTypes } from '../shared/character-images';
import type { AppSnapshot, Settings, ViewName, WorkerResponse } from '../shared/contracts';

app.setName('SearchGal');
app.setAppUserModelId('io.searchgal.desktop');
// Keep installed-app verification (and explicitly selected profiles) out of the user's normal data.
const profileDirectory = app.commandLine.getSwitchValue('user-data-dir')
  || (!app.isPackaged ? process.env.SEARCHGAL_DATA_DIR : undefined);
if (profileDirectory) app.setPath('userData', resolve(profileDirectory));
protocol.registerSchemesAsPrivileged([{ scheme: 'searchgal-asset', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }]);

let panel: BrowserWindow | undefined;
let pet: BrowserWindow | undefined;
let tray: Tray | undefined;
let service: DesktopService;
let quitting = false;
let drag: { cursor: { x: number; y: number }; position: { x: number; y: number }; timer: NodeJS.Timeout } | undefined;
const dataDirectory = app.getPath('userData');
const charactersDirectory = join(dataDirectory, 'characters');
const preload = resolve(__dirname, '../preload/index.cjs');

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { void showPanel(); });
  app.whenReady().then(start).catch(error => {
    console.error(error);
    if (!process.env.SEARCHGAL_E2E) dialog.showErrorBox('SearchGal 无法启动', error instanceof Error ? error.message : String(error));
    app.exit(1);
  });
}

const workerFactory: WorkerFactory = (request, onMessage, onExit) => {
  try {
    const child = utilityProcess.fork(resolve(__dirname, 'worker.cjs'), [], { stdio: 'pipe', serviceName: 'SearchGal 后台任务' });
    child.on('message', (message: WorkerResponse) => onMessage(message));
    child.once('exit', code => onExit(code));
    child.once('spawn', () => child.postMessage(request));
    child.stderr?.on('data', data => { if (!app.isPackaged) console.error(String(data).trim()); });
    return child;
  } catch (error) {
    queueMicrotask(() => onMessage({ kind: 'error', error: error instanceof Error ? error.message : String(error) }));
    return { postMessage: () => undefined, kill: () => false };
  }
};

async function start(): Promise<void> {
  const defaults = defaultState(join(app.getPath('downloads'), 'SearchGal'), process.env.SEARCHGAL_API ?? '');
  if (!app.isPackaged && process.env.SEARCHGAL_E2E) {
    defaults.settings.notifications = false;
    defaults.settings.downloadDirectory = join(dataDirectory, 'downloads');
  }
  service = new DesktopService(new StateStore(dataDirectory, defaults, {
    encrypt(value) {
      if (!safeStorage.isEncryptionAvailable() || (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text')) {
        throw new Error('系统安全存储不可用，无法保存 API Key');
      }
      return safeStorage.encryptString(value).toString('base64');
    },
    decrypt: value => safeStorage.decryptString(Buffer.from(value, 'base64')),
  }), workerFactory,
    { version: app.getVersion(), platform: process.platform, packaged: app.isPackaged });
  await service.initialize();
  service.on('change', (snapshot: AppSnapshot) => {
    for (const window of [panel, pet]) if (window && !window.isDestroyed()) window.webContents.send('app:state', snapshot);
  });
  service.on('settings', (settings: Settings) => { applyPetSettings(settings); updateTray(); });
  service.on('completed', (title: string) => {
    if (service.settings.notifications && Notification.isSupported()) {
      const notification = new Notification({ title: '下载完成', body: `${title} 已保存到下载文件夹`, silent: !service.settings.sound });
      notification.on('click', () => { void showPanel('downloads'); });
      notification.show();
    }
  });
  await mkdir(charactersDirectory, { recursive: true });
  protocol.handle('searchgal-asset', async request => {
    const url = new URL(request.url);
    const id = url.pathname.slice(1);
    const character = service.characters.find(character => character.id === id);
    if (url.hostname !== 'characters' || !/^[a-f0-9-]{36}$/.test(id) || !character) return new Response('Not found', { status: 404 });
    try {
      const filename = url.searchParams.get('preview') === '1' && character.preview ? character.preview : character.image;
      const contents = await readFile(join(charactersDirectory, filename));
      return new Response(new Uint8Array(contents), { headers: { 'Content-Type': characterImageTypes[characterImageFormat(filename)!], 'Cache-Control': 'public, max-age=3600', 'Access-Control-Allow-Origin': '*' } });
    } catch { return new Response('Not found', { status: 404 }); }
  });
  registerIpc();
  tray = new Tray(trayImage());
  tray.setToolTip('SearchGal');
  // On macOS, setContextMenu handles clicks by opening the native menu.
  if (process.platform !== 'darwin') tray.on('click', () => { void showPanel(); });
  updateTray();
  await showPanel();
  applyPetSettings(service.settings);
  screen.on('display-removed', () => applyPetSettings(service.settings));
  screen.on('display-metrics-changed', () => { if (!drag) applyPetSettings(service.settings); });
  app.on('activate', () => { void showPanel(); });
  app.on('before-quit', event => {
    if (quitting) return;
    event.preventDefault();
    quitting = true;
    stopDrag();
    void service.shutdown().catch(console.error).finally(() => app.quit());
  });
}

async function loadWindow(window: BrowserWindow, hash: string): Promise<void> {
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  if (!app.isPackaged && process.env.SEARCHGAL_DEV_URL) await window.loadURL(process.env.SEARCHGAL_DEV_URL + '#' + hash);
  else await window.loadFile(resolve(__dirname, '../renderer/index.html'), { hash });
}

async function showPanel(view?: ViewName): Promise<void> {
  if (!panel || panel.isDestroyed()) {
    panel = new BrowserWindow({
      width: 1080, height: 760, minWidth: 860, minHeight: 620,
      frame: process.platform === 'darwin',
      titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : undefined,
      show: false, backgroundColor: '#f8f7f4', title: 'SearchGal',
      webPreferences: { preload, contextIsolation: true, sandbox: true, nodeIntegration: false },
    });
    panel.on('close', event => { if (!quitting) { event.preventDefault(); panel?.hide(); } });
    panel.on('closed', () => { panel = undefined; });
    await loadWindow(panel, view ?? 'search');
  }
  if (panel.isMinimized()) panel.restore();
  panel.show();
  panel.focus();
  if (view) panel.webContents.send('app:view', view);
}

function applyPetSettings(settings: Settings): void {
  if (!settings.petVisible || !settings.characterId) { stopDrag(); pet?.hide(); return; }
  const width = settings.petSize + 80;
  const height = settings.petSize + 132;
  const workArea = screen.getPrimaryDisplay().workArea;
  const position = settings.petPosition ?? { x: workArea.x + workArea.width - width - 20, y: workArea.y + workArea.height - height - 20 };
  const bounds = clampPet(position, width, height);
  if (!pet || pet.isDestroyed()) {
    pet = new BrowserWindow({
      ...bounds, frame: false, transparent: true, hasShadow: false, alwaysOnTop: true,
      skipTaskbar: true, resizable: false, show: false,
      webPreferences: { preload, contextIsolation: true, sandbox: true, nodeIntegration: false },
    });
    pet.setIgnoreMouseEvents(true, { forward: true });
    pet.on('closed', () => { pet = undefined; });
    void loadWindow(pet, 'pet').then(() => { if (service.settings.petVisible && service.settings.characterId) pet?.showInactive(); });
  } else { pet.setBounds(bounds); pet.showInactive(); }
}

function clampPet(position: { x: number; y: number }, width: number, height: number) {
  const work = screen.getDisplayNearestPoint({ x: Math.round(position.x + width / 2), y: Math.round(position.y + height / 2) }).workArea;
  return {
    width, height,
    x: Math.round(Math.max(work.x, Math.min(position.x, work.x + work.width - width))),
    y: Math.round(Math.max(work.y, Math.min(position.y, work.y + work.height - height))),
  };
}

function stopDrag(): void {
  if (!drag) return;
  clearInterval(drag.timer);
  drag = undefined;
  if (pet && !pet.isDestroyed()) {
    const { x, y, width, height } = pet.getBounds();
    const bounds = clampPet({ x, y }, width, height);
    pet.setBounds(bounds);
    void service.updateSettings({ petPosition: { x: bounds.x, y: bounds.y } }).catch(console.error);
  }
}

function updateTray(): void {
  tray?.setContextMenu(Menu.buildFromTemplate([
    { label: '打开 SearchGal', click: () => { void showPanel('search'); } },
    { label: '下载任务', click: () => { void showPanel('downloads'); } },
    { label: '我的伙伴', click: () => { void showPanel('companions'); } },
    { type: 'separator' },
    { label: '显示桌面伙伴', type: 'checkbox', checked: service.settings.petVisible, enabled: Boolean(service.settings.characterId),
      click: item => { void service.updateSettings({ petVisible: item.checked }).catch(console.error); } },
    { label: '退出（保存并暂停任务）', click: () => app.quit() },
  ]));
}

function registerIpc(): void {
  const handle = (channel: string, action: (...args: any[]) => unknown) => ipcMain.handle(channel, (event, ...args) => {
    if (event.sender !== panel?.webContents && event.sender !== pet?.webContents) throw new Error('Unknown window');
    return action(...args);
  });
  handle('app:snapshot', () => service.snapshot());
  handle('search:start', (query, autoDownload) => service.search(query, autoDownload));
  handle('search:stop', () => service.stopSearch());
  handle('task:create', id => service.download(id));
  handle('task:pause', id => service.pause(id));
  handle('task:resume', id => service.resume(id));
  handle('task:cancel', id => service.cancel(id));
  handle('task:copy-password', id => {
    const password = service.task(id).password;
    if (!password) throw new Error('该任务没有可复制的解压密码');
    clipboard.writeText(password);
  });
  handle('task:open-folder', async id => {
    const path = service.task(id).outputDirectory;
    await mkdir(path, { recursive: true });
    const error = await shell.openPath(path);
    if (error) throw new Error(error);
  });
  handle('search:open-source', id => shell.openExternal(service.candidateUrl(id)));
  handle('task:open-source', id => {
    const url = service.task(id).sourceUrl;
    if (!url || !/^https?:\/\//i.test(url)) throw new Error('来源页面不可用');
    return shell.openExternal(url);
  });
  handle('settings:choose-directory', async () => {
    const result = await dialog.showOpenDialog(panel!, { title: '选择下载文件夹', defaultPath: service.settings.downloadDirectory, properties: ['openDirectory', 'createDirectory'] });
    return result.canceled ? null : result.filePaths[0];
  });
  handle('settings:update', async change => {
    if (!change || typeof change !== 'object' || Array.isArray(change)) throw new Error('设置格式不正确');
    await service.updateSettings(change);
    if ('launchAtLogin' in change && app.isPackaged) app.setLoginItemSettings({ openAtLogin: service.settings.launchAtLogin });
  });
  handle('settings:llm', (settings, apiKey) => service.updateLLMSettings(settings, apiKey));
  handle('character:import', importCharacter);
  handle('character:remove', async id => {
    const character = service.characters.find(character => character.id === id);
    if (!character) throw new Error('角色不存在');
    await service.removeCharacter(id);
    for (const filename of [character.image, character.preview]) {
      if (filename) await unlink(join(charactersDirectory, filename)).catch(error => { if (error.code !== 'ENOENT') throw error; });
    }
  });
  handle('window:show', view => showPanel(['search', 'downloads', 'companions', 'settings'].includes(view) ? view : undefined));
  handle('window:hide', () => panel?.hide());
  handle('window:minimize', () => panel?.minimize());
  handle('window:maximize', () => { if (panel?.isMaximized()) panel.unmaximize(); else panel?.maximize(); });
  handle('app:quit', () => app.quit());
  ipcMain.on('pet:pointer', (event, interactive) => {
    if (event.sender === pet?.webContents && typeof interactive === 'boolean' && !drag) pet?.setIgnoreMouseEvents(!interactive, { forward: true });
  });
  ipcMain.on('pet:drag', (event, action) => {
    if (event.sender !== pet?.webContents || !pet) return;
    if (action === 'start' && !drag) {
      const [x, y] = pet.getPosition();
      drag = {
        position: { x, y }, cursor: screen.getCursorScreenPoint(),
        timer: setInterval(() => {
          if (!drag || !pet || pet.isDestroyed()) return;
          const point = screen.getCursorScreenPoint();
          pet.setPosition(Math.round(drag.position.x + point.x - drag.cursor.x), Math.round(drag.position.y + point.y - drag.cursor.y));
        }, 16),
      };
      pet.setIgnoreMouseEvents(false);
    } else if (action === 'end') stopDrag();
  });
}

async function importCharacter() {
  const result = await dialog.showOpenDialog(panel!, { title: '添加你的桌面伙伴', filters: [{ name: '角色图片或动图', extensions: ['png', 'gif', 'webp'] }], properties: ['openFile'] });
  if (result.canceled) return null;
  const path = result.filePaths[0];
  if ((await stat(path)).size > 10 * 1024 * 1024) throw new Error('请选择小于 10 MB 的角色图片或动图');
  const bytes = await readFile(path);
  if (bytes.length > 10 * 1024 * 1024) throw new Error('请选择小于 10 MB 的角色图片或动图');
  const { format, width, height, frameCount, preview } = await decodeCharacterImage(panel!, bytes);
  const id = randomUUID();
  const character = { id, name: basename(path).replace(/\.(png|gif|webp)$/i, '').slice(0, 40), image: `${id}.${format}`, preview: `${id}.preview.png`, width, height, frameCount, createdAt: new Date().toISOString() };
  await writeFile(join(charactersDirectory, character.image), bytes);
  await writeFile(join(charactersDirectory, character.preview), preview);
  await service.addCharacter(character);
  return character;
}

/** 搜索符号作为系统托盘图标；默认角色素材由用户提供。 */
function trayImage() {
  const size = 20;
  const bytes = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const radius = Math.hypot(x - 8, y - 8);
    const visible = (radius > 4 && radius < 6) || (x >= 12 && y >= 12 && x <= 17 && y <= 17 && Math.abs(x - y) < 2);
    const offset = (y * size + x) * 4;
    bytes[offset] = 58; bytes[offset + 1] = 69; bytes[offset + 2] = 85; bytes[offset + 3] = visible ? 255 : 0;
  }
  const image = nativeImage.createFromBitmap(bytes, { width: size, height: size });
  if (process.platform === 'darwin') image.setTemplateImage(true);
  return image;
}
