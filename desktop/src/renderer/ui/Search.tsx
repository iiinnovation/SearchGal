import { useEffect, useMemo, useState } from 'react';
import { Search, ArrowRight, ArrowUpRight, Download, X, LoaderCircle, History, Compass, Check, AlertCircle } from 'lucide-react';
import type { AppSnapshot } from '../../shared/contracts';
import { api, type RunAction } from './lib';

export function SearchView({ snapshot, run, onDownload }: { snapshot: AppSnapshot; run: RunAction; onDownload(): void }) {
  const { search } = snapshot;
  const [query, setQuery] = useState(search.query);
  const [filter, setFilter] = useState('all');
  const [adding, setAdding] = useState(false);
  useEffect(() => { if (search.query) setQuery(search.query); }, [search.query]);
  const visible = useMemo(() => search.candidates.filter(candidate => filter === 'all' ||
    (filter === 'free' && candidate.platformTags.includes('NoReq')) ||
    (filter === 'direct' && candidate.reasons.includes('可自动解析下载地址'))), [search.candidates, filter]);
  const searching = search.status === 'searching';
  const startSearch = (value = query, autoDownload = false) => run(() => api.search(value, autoDownload));
  const chooseDirectory = () => run(async () => {
    const directory = await api.chooseDirectory();
    if (directory) await api.updateSettings({ downloadDirectory: directory });
  });
  const download = (id?: string) => {
    if (adding) return;
    setAdding(true);
    run(async () => { try { await api.download(id); onDownload(); } finally { setAdding(false); } });
  };

  return <section className="search-view">
    <div className="page-heading"><span className="eyebrow">DISCOVER</span><h1>找到想玩的游戏。</h1><p>输入游戏名，自动查找来源并下载到你指定的位置。</p></div>
    <form className="search-form" onSubmit={event => { event.preventDefault(); if (!searching) startSearch(query, true); }}>
      <Search size={22} /><input aria-label="游戏名称" placeholder="输入游戏名，试试中文名或日文原名" value={query} maxLength={200} onChange={event => setQuery(event.target.value)} autoFocus autoComplete="off" />
      {query && <button className="icon-button" type="button" aria-label="清空搜索" onClick={() => setQuery('')}><X size={17} /></button>}
      <button className="text-button" disabled={!query.trim() || searching} type="button" onClick={() => startSearch()}>搜索</button>
      <button className="primary search-submit" disabled={!query.trim() || searching} type="submit">自动下载<ArrowRight size={17} /></button>
    </form>
    <div className="search-destination"><span title={snapshot.settings.downloadDirectory}>保存到：{snapshot.settings.downloadDirectory}</span><button className="text-button" disabled={searching} onClick={chooseDirectory}>更改位置</button></div>
    {searching && <div className="search-progress" role="status"><LoaderCircle size={15} className="spin" /><span>正在查找{search.total ? ` · ${search.completed} / ${search.total} 个平台` : '资源平台'}…{search.autoDownload ? ' 找到匹配来源后会自动开始下载。' : ''}</span><button className="text-button" onClick={() => run(() => api.cancelSearch())}>停止搜索</button></div>}
    {search.error && <div className="inline-error" role="alert"><AlertCircle size={17} /><span>{search.error}</span></div>}

    {!search.query && <>
      {snapshot.recentSearches.length > 0 && <div className="recent-searches"><span><History size={14} />最近搜索</span><div>{snapshot.recentSearches.map(value => <button className="chip" key={value} onClick={() => { setQuery(value); startSearch(value); }}>{value}</button>)}</div></div>}
      <div className="welcome-card"><div className="welcome-symbol"><Compass size={36} strokeWidth={1.2} /></div><h2>从一个名字开始</h2><p>输入名称后回车，自动搜索并按推荐顺序尝试下载。<br />来源失效会尝试备用来源，也可以点击“搜索”自行挑选。</p><div className="feature-notes"><span><Check size={14} />自动查找来源</span><span><Check size={14} />分卷一起下载</span><span><Check size={14} />随时暂停继续</span></div></div>
    </>}

    {search.query && <div className="results-section">
      <div className="section-heading"><div><h2>搜索结果 <span className="count">{search.candidates.length}</span></h2><p>{search.query}{search.errors.length > 0 ? ` · ${search.errors.length} 个平台暂时不可用` : ''}</p></div>
        {search.candidates.length > 0 && !search.autoDownload && <button className="secondary" disabled={adding} onClick={() => download()}><Download size={16} />自动选源下载</button>}
      </div>
      {search.candidates.length > 0 && <div className="filter-row">{[['all', '全部来源'], ['direct', '可自动解析'], ['free', '免登录']].map(([id, text]) => <button key={id} className={`filter ${filter === id ? 'active' : ''}`} onClick={() => setFilter(id)}>{text}</button>)}<span>{visible.length} 条结果</span></div>}
      <div className="result-list">{visible.map((candidate, index) => <article className="result-card" key={candidate.id} data-testid="result-card">
        <div className="source-monogram">{candidate.platform.slice(0, 1)}</div>
        <div className="result-content"><div className="result-source"><span>{candidate.platform}</span>{index === 0 && filter === 'all' && <small>推荐来源</small>}</div><h3 title={candidate.name}>{candidate.name}</h3>
          <div className="tags">{candidate.platformTags.includes('NoReq') && <span>免登录</span>}{candidate.platformTags.includes('SuDrive') && <span>自建网盘</span>}{candidate.platformTags.includes('BTmag') && <span>BT 资源</span>}{candidate.platformTags.some(tag => tag.startsWith('Login')) && <span className="muted-tag">需登录</span>}{candidate.reasons.includes('可自动解析下载地址') && <span>可自动解析</span>}</div>
        </div><div className="result-actions"><button className="download-button" disabled={adding} onClick={() => download(candidate.id)}><Download size={16} />下载</button><button className="source-link" onClick={() => run(() => api.openCandidate(candidate.id))}>来源页<ArrowUpRight size={12} /></button></div>
      </article>)}</div>
      {visible.length === 0 && <div className="empty-state"><Search size={30} strokeWidth={1.2} /><h3>{searching ? '正在等待第一条结果' : search.candidates.length ? '没有符合筛选条件的来源' : '暂时没有找到这部作品'}</h3><p>{searching ? '各个平台的返回速度不同，结果会陆续显示。' : '试着缩短关键词，或换一个中文、日文名称。'}</p></div>}
      {search.candidates.length > 0 && <p className="footnote">资源来自各平台，部分来源可能需要登录或手动转存。自动下载失败时可以打开来源页处理。</p>}
    </div>}
  </section>;
}
