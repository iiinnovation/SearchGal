import { useState } from 'react';
import { Download, FolderOpen, Pause, Play, X, Check, ArrowUpRight, RotateCcw, ArrowRight, FileArchive, LoaderCircle, KeyRound, Copy } from 'lucide-react';
import type { AppSnapshot } from '../../shared/contracts';
import { api, bytes, progress, statusText, time, type RunAction } from './lib';

export function DownloadsView({ snapshot, run, onSearch }: { snapshot: AppSnapshot; run: RunAction; onSearch(): void }) {
  const [filter, setFilter] = useState('all');
  const [copied, setCopied] = useState<{ id: string; password: string }>();
  const visible = snapshot.tasks.filter(task => filter === 'all' || (filter === 'completed' ? task.status === 'completed' : task.status !== 'completed' && task.status !== 'cancelled'));
  return <section><div className="page-heading compact"><span className="eyebrow">YOUR DOWNLOADS</span><h1>故事，正在抵达。</h1><p>查看进度，暂停一下，或从上次停下的地方继续。</p></div>
    <div className="download-toolbar"><div className="filter-row">{[['all', '全部任务'], ['active', '进行中'], ['completed', '已完成']].map(([id, label]) => <button key={id} className={`filter ${filter === id ? 'active' : ''}`} onClick={() => setFilter(id)}>{label}</button>)}</div><button className="text-button" onClick={onSearch}>继续找游戏<ArrowRight size={15} /></button></div>
    <div className="task-list">{visible.map(task => {
      const meter = progress(task);
      const running = task.status === 'downloading' || task.status === 'resolving';
      const stopping = task.status === 'pausing' || task.status === 'cancelling';
      const restartable = ['paused', 'failed', 'cancelled'].includes(task.status);
      const file = task.files[task.fileIndex];
      return <article key={task.id} className={`task-card ${task.status}`} data-testid="task-card" data-status={task.status} data-task-id={task.id}>
        <div className="task-top"><span className="task-icon">{task.status === 'completed' ? <Check size={23} /> : <FileArchive size={23} />}</span><div className="task-title"><h3>{task.title}</h3><p>{task.platform ? `${task.platform}${task.attemptCount > 1 ? ` · 来源 ${task.attemptIndex + 1}/${task.attemptCount}` : ''}` : '等待开始'}</p></div><span className={`task-status status-${task.status}`}>{stopping && <LoaderCircle size={12} className="spin" />}{statusText[task.status]}</span></div>
        <div className="task-progress-label"><span>{task.status === 'completed' ? `${task.files.length} 个文件已保存` : file ? `${task.fileIndex + 1} / ${task.files.length} · ${file.name}` : meter.label}</span><strong>{meter.value === undefined ? '' : `${meter.value.toFixed(0)}%`}</strong></div>
        <div className={`progress-track ${meter.value === undefined && running ? 'indeterminate' : ''}`} role="progressbar" aria-label={`${task.title}下载进度`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={meter.value}><span style={{ width: `${meter.value ?? 0}%` }} /></div>
        <div className="task-meta"><span>{meter.label}{task.status === 'downloading' && task.bytesPerSecond > 0 ? ` · ${bytes(task.bytesPerSecond)}/s` : ''}</span><span>{task.status === 'downloading' ? time(task.etaSeconds) : ''}</span></div>
        {task.error && <p className="task-error">{task.error}</p>}
        {task.password && <div className="task-password"><KeyRound size={16} /><span>解压密码</span><code>{task.password}</code><button className="icon-button" title="复制解压密码" aria-label="复制解压密码" onClick={() => run(async () => {
          await api.copyTaskPassword(task.id); setCopied({ id: task.id, password: task.password! });
        })}>{copied?.id === task.id && copied.password === task.password ? <Check size={16} /> : <Copy size={16} />}</button><span className="sr-only" role="status">{copied?.id === task.id && copied.password === task.password ? '密码已复制' : ''}</span></div>}
        {task.passwordAssessment && <p className={`password-assessment ${task.passwordAssessment.canExtractWithoutExtraPassword ? '' : 'warning'}`}>
          {task.passwordAssessment.canExtractWithoutExtraPassword ? (task.passwordAssessment.hasPassword ? '已找到公开密码' : '未发现密码门槛') : '需要额外密码'}：{task.passwordAssessment.reason}
        </p>}
        {!task.password && task.passwordNote && <p className="password-assessment warning">{task.passwordNote}</p>}
        {task.manualHints.length > 0 && <details className="manual-hints"><summary>查看手动处理提示</summary>{task.manualHints.map((hint, i) => <p key={i}>{hint}</p>)}</details>}
        <div className="task-footer"><button className="source-link" onClick={() => run(() => api.openTaskFolder(task.id))}><FolderOpen size={15} />打开文件夹</button><div>
          {task.status === 'failed' && task.sourceUrl && <button className="text-button" onClick={() => run(() => api.openTaskSource(task.id))}>查看来源<ArrowUpRight size={13} /></button>}
          {(running || task.status === 'queued') && <button className="secondary small" onClick={() => run(() => api.pause(task.id))}><Pause size={14} />暂停</button>}
          {restartable && <button className="secondary small" onClick={() => run(() => api.resume(task.id))}>{task.status === 'paused' ? <Play size={14} /> : <RotateCcw size={14} />}{task.status === 'paused' ? '继续下载' : '重试'}</button>}
          {!['completed', 'cancelled'].includes(task.status) && <button className="icon-button" disabled={stopping} title="取消任务，保留已下载文件" aria-label={`取消 ${task.title}`} onClick={() => run(() => api.cancel(task.id))}><X size={16} /></button>}
        </div></div>
      </article>;
    })}</div>
    {visible.length === 0 && <div className="empty-state large"><Download size={36} strokeWidth={1.1} /><h3>{filter === 'completed' ? '还没有完成的下载' : '这里还没有下载任务'}</h3><p>找到一部喜欢的作品，交给 SearchGal 慢慢下载。</p><button className="primary" onClick={onSearch}>去发现作品<ArrowRight size={15} /></button></div>}
    <p className="footnote">隐藏窗口后任务会继续。退出应用会保存并暂停任务，下次打开可以继续下载。</p>
  </section>;
}
