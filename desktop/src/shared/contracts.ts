import type { ArchivePasswordAssessment, Candidate, SearchOutcome, SearchResult } from '../../../downloader/src/types/index.js';
import type { AppConfig } from '../../../downloader/src/utils/config.js';
import type { DownloadEvent, EngineResult, FileCheckpoint } from '../../../downloader/src/core/DownloadEngine.js';

export type TaskStatus = 'queued' | 'resolving' | 'downloading' | 'pausing' | 'paused' | 'cancelling' | 'cancelled' | 'completed' | 'failed';
export type ViewName = 'search' | 'downloads' | 'companions' | 'settings';

export interface Settings {
  llm: {
    enabled: boolean;
    baseURL: string;
    model: string;
    timeoutMs: number;
    failureMode: 'continue' | 'skip';
  };
  downloadDirectory: string;
  apiUrl: string;
  proxyUrl: string;
  notifications: boolean;
  sound: boolean;
  launchAtLogin: boolean;
  petVisible: boolean;
  petSize: number;
  petPosition?: { x: number; y: number };
  characterId?: string;
  nickname: string;
}

export interface Character {
  id: string;
  name: string;
  image: string;
  preview?: string;
  frameCount?: number;
  width: number;
  height: number;
  createdAt: string;
}

export interface TaskFile {
  name: string;
  state: 'pending' | 'downloading' | 'completed';
  totalBytes?: number;
  receivedBytes: number;
  filepath?: string;
}

export interface DownloadTask {
  password?: string;
  passwordNote?: string;
  passwordAssessment?: ArchivePasswordAssessment;
  id: string;
  title: string;
  status: TaskStatus;
  createdAt: string;
  updatedAt: string;
  outputDirectory: string;
  candidateName?: string;
  platform?: string;
  sourceUrl?: string;
  attemptIndex: number;
  attemptCount: number;
  fileIndex: number;
  files: TaskFile[];
  bytesPerSecond: number;
  etaSeconds?: number;
  error?: string;
  manualHints: string[];
}

export interface StoredTask extends DownloadTask {
  queue: Candidate[];
  checkpoints: FileCheckpoint[];
}

export interface CandidateItem extends Candidate { id: string }

export interface SearchState {
  status: 'idle' | 'searching' | 'complete' | 'failed';
  autoDownload?: boolean;
  taskId?: string;
  query: string;
  completed: number;
  total: number;
  candidates: CandidateItem[];
  errors: Array<{ platform: string; message: string }>;
  error?: string;
}

export interface AppSnapshot {
  llmKeyConfigured: boolean;
  version: string;
  platform: string;
  packaged: boolean;
  settings: Settings;
  tasks: DownloadTask[];
  characters: Character[];
  search: SearchState;
  recentSearches: string[];
  notice?: string;
}

export interface StoredState {
  /** In memory only. StateStore encrypts this value before writing to disk. */
  llmApiKey?: string;
  version: 1;
  settings: Settings;
  tasks: StoredTask[];
  characters: Character[];
  recentSearches: string[];
}

export interface SearchEvent {
  total?: number;
  progress?: { completed: number; total: number };
  result?: SearchResult;
}

export type WorkerRequest =
  | { kind: 'search'; query: string; apiUrl: string; proxyUrl: string }
  | { kind: 'download'; queue: Candidate[]; outputDirectory: string; checkpoints: FileCheckpoint[]; proxyUrl: string; llm?: AppConfig }
  | { kind: 'abort' };

export type WorkerResponse =
  | { kind: 'search-event'; event: SearchEvent }
  | { kind: 'search-complete'; outcome: SearchOutcome }
  | { kind: 'download-event'; event: DownloadEvent }
  | { kind: 'download-complete'; result: EngineResult }
  | { kind: 'aborted' }
  | { kind: 'error'; error: string };

export interface DesktopApi {
  snapshot(): Promise<AppSnapshot>;
  subscribe(listener: (snapshot: AppSnapshot) => void): () => void;
  onView(listener: (view: ViewName) => void): () => void;
  search(query: string, autoDownload?: boolean): Promise<void>;
  cancelSearch(): Promise<void>;
  download(candidateId?: string): Promise<string>;
  pause(id: string): Promise<void>;
  resume(id: string): Promise<void>;
  cancel(id: string): Promise<void>;
  openTaskFolder(id: string): Promise<void>;
  openTaskSource(id: string): Promise<void>;
  openCandidate(id: string): Promise<void>;
  chooseDirectory(): Promise<string | null>;
  updateSettings(settings: Partial<Settings>): Promise<void>;
  updateLLMSettings(settings: Settings['llm'], apiKey?: string): Promise<void>;
  copyTaskPassword(id: string): Promise<void>;
  importCharacter(): Promise<Character | null>;
  removeCharacter(id: string): Promise<void>;
  showPanel(view?: ViewName): Promise<void>;
  hidePanel(): Promise<void>;
  minimize(): Promise<void>;
  maximize(): Promise<void>;
  quit(): Promise<void>;
  petPointer(interactive: boolean): void;
  petDrag(action: 'start' | 'move' | 'end'): void;
}
