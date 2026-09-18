import { useEffect, useState } from 'react';
import { Search, Download, SlidersHorizontal, Heart, Plus, Minus, Square, X, ArrowUpRight, AlertCircle, LoaderCircle } from 'lucide-react';
import type { AppSnapshot, ViewName } from '../../shared/contracts';
import { SearchView } from './Search';
import { DownloadsView } from './Downloads';
import { SettingsView } from './Settings';
import { CompanionsView } from './Companions';
import { Pet } from './Pet';
import { api, characterUrl, type RunAction } from './lib';

const pages = [
  { id: 'search' as const, title: '发现作品', icon: Search },
  { id: 'downloads' as const, title: '下载任务', icon: Download },
  { id: 'companions' as const, title: '我的伙伴', icon: Heart },
  { id: 'settings' as const, title: '偏好设置', icon: SlidersHorizontal },
];

export function App() {
  const [snapshot, setSnapshot] = useState<AppSnapshot>();
  const initial = window.location.hash.slice(1);
  const [view, setView] = useState<ViewName>(pages.some(page => page.id === initial) ? initial as ViewName : 'search');
  const [error, setError] = useState('');
  const pet = initial === 'pet';
  const run: RunAction = action => { setError(''); void action().catch(error => setError(String(error instanceof Error ? error.message : error).replace(/^Error invoking remote method '[^']+': Error: /, ''))); };

  useEffect(() => {
    if (!api) { setError('请从 SearchGal 桌面应用打开此界面'); return; }
    let live = true;
    let received = false;
    const unsubscribe = api.subscribe(state => { received = true; if (live) setSnapshot(state); });
    const unview = api.onView(view => { if (live) setView(view); });
    void api.snapshot().then(state => { if (live && !received) setSnapshot(state); }).catch(error => { if (live) setError(String(error)); });
    return () => { live = false; unsubscribe(); unview(); };
  }, []);

  useEffect(() => { document.body.dataset.window = pet ? 'pet' : 'panel'; }, [pet]);
  useEffect(() => { if (snapshot?.search.taskId) setView('downloads'); }, [snapshot?.search.taskId]);
  if (!snapshot) return pet ? null : <div className="boot-screen"><Search size={28} /><strong>SearchGal</strong><p>{error || '正在准备你的工作台…'}</p>{!error && <LoaderCircle className="spin" size={18} />}</div>;
  if (pet) return <Pet snapshot={snapshot} run={run} />;
  const character = snapshot.characters.find(character => character.id === snapshot.settings.characterId);
  const active = snapshot.tasks.filter(task => ['queued', 'resolving', 'downloading', 'pausing'].includes(task.status)).length;

  return <div className="app-shell" data-platform={snapshot.platform}>
    <aside className="sidebar">
      <div className="brand drag-region"><span className="brand-mark"><Search size={22} strokeWidth={2.3} /></span><div><strong>SearchGal</strong><span>故事，从这里开始</span></div></div>
      <nav aria-label="主导航">{pages.map(({ id, title, icon: Icon }) => <button key={id} className={`nav-item ${view === id ? 'selected' : ''}`} onClick={() => setView(id)} aria-current={view === id ? 'page' : undefined}>
        <Icon size={19} /><span>{title}</span>{id === 'downloads' && active > 0 && <small className="nav-count">{active}</small>}
      </button>)}</nav>
      <div className="sidebar-bottom">
        <button className="companion-shortcut" onClick={() => setView('companions')}>
          <span className="mini-portrait">{character ? <img src={characterUrl(character.id, true)} alt="" /> : <Plus size={20} />}</span>
          <span><strong>{character ? snapshot.settings.nickname : '添加桌面伙伴'}</strong><small>{character ? '在桌面陪你找游戏' : '从一张喜欢的立绘开始'}</small></span><ArrowUpRight size={15} />
        </button>
        <div className="sidebar-foot"><span className="status-dot" />{snapshot.settings.apiUrl ? '自定义搜索服务' : '本地搜索'}<span>v{snapshot.version}</span></div>
      </div>
    </aside>
    <div className="workspace">
      <header className="titlebar drag-region"><span>{pages.find(page => page.id === view)?.title}</span>{snapshot.platform !== 'darwin' && <div className="window-controls no-drag">
        <button aria-label="最小化" onClick={() => run(() => api.minimize())}><Minus size={15} /></button>
        <button aria-label="最大化或还原" onClick={() => run(() => api.maximize())}><Square size={12} /></button>
        <button aria-label="隐藏到托盘" className="close-window" onClick={() => run(() => api.hidePanel())}><X size={16} /></button>
      </div>}</header>
      <main className="main-scroll">
        {(error || snapshot.notice) && <div className="notice" role="alert"><AlertCircle size={17} /><span>{error || snapshot.notice}</span>{error && <button className="icon-button" aria-label="关闭提示" onClick={() => setError('')}><X size={15} /></button>}</div>}
        {view === 'search' && <SearchView snapshot={snapshot} run={run} onDownload={() => setView('downloads')} />}
        {view === 'downloads' && <DownloadsView snapshot={snapshot} run={run} onSearch={() => setView('search')} />}
        {view === 'settings' && <SettingsView snapshot={snapshot} run={run} />}
        {view === 'companions' && <CompanionsView snapshot={snapshot} run={run} />}
      </main>
    </div>
  </div>;
}
