import { contextBridge, ipcRenderer } from 'electron';
import type { AppSnapshot, DesktopApi, ViewName } from '../shared/contracts';

const api: DesktopApi = {
  snapshot: () => ipcRenderer.invoke('app:snapshot'),
  subscribe: listener => {
    const receive = (_event: unknown, snapshot: AppSnapshot) => listener(snapshot);
    ipcRenderer.on('app:state', receive);
    return () => ipcRenderer.removeListener('app:state', receive);
  },
  onView: listener => {
    const receive = (_event: unknown, view: ViewName) => listener(view);
    ipcRenderer.on('app:view', receive);
    return () => ipcRenderer.removeListener('app:view', receive);
  },
  search: (query, autoDownload = false) => ipcRenderer.invoke('search:start', query, autoDownload),
  cancelSearch: () => ipcRenderer.invoke('search:stop'),
  download: id => ipcRenderer.invoke('task:create', id),
  pause: id => ipcRenderer.invoke('task:pause', id),
  resume: id => ipcRenderer.invoke('task:resume', id),
  cancel: id => ipcRenderer.invoke('task:cancel', id),
  openTaskFolder: id => ipcRenderer.invoke('task:open-folder', id),
  openTaskSource: id => ipcRenderer.invoke('task:open-source', id),
  openCandidate: id => ipcRenderer.invoke('search:open-source', id),
  chooseDirectory: () => ipcRenderer.invoke('settings:choose-directory'),
  updateSettings: settings => ipcRenderer.invoke('settings:update', settings),
  updateLLMSettings: (settings, apiKey) => ipcRenderer.invoke('settings:llm', settings, apiKey),
  copyTaskPassword: id => ipcRenderer.invoke('task:copy-password', id),
  importCharacter: () => ipcRenderer.invoke('character:import'),
  removeCharacter: id => ipcRenderer.invoke('character:remove', id),
  showPanel: view => ipcRenderer.invoke('window:show', view),
  hidePanel: () => ipcRenderer.invoke('window:hide'),
  minimize: () => ipcRenderer.invoke('window:minimize'),
  maximize: () => ipcRenderer.invoke('window:maximize'),
  quit: () => ipcRenderer.invoke('app:quit'),
  petPointer: interactive => ipcRenderer.send('pet:pointer', interactive),
  petDrag: action => ipcRenderer.send('pet:drag', action),
};

contextBridge.exposeInMainWorld('searchgal', api);
