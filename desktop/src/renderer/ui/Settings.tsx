import { useEffect, useState } from 'react';
import { FolderOpen, Bell, Globe, Power, Volume2, ChevronRight, KeyRound, Save, Trash2 } from 'lucide-react';
import type { AppSnapshot } from '../../shared/contracts';
import { api, type RunAction } from './lib';

export function SettingsView({ snapshot, run }: { snapshot: AppSnapshot; run: RunAction }) {
  const { settings } = snapshot;
  const [apiUrl, setApiUrl] = useState(settings.apiUrl);
  const [proxyUrl, setProxyUrl] = useState(settings.proxyUrl);
  const [saved, setSaved] = useState(false);
  useEffect(() => { setApiUrl(settings.apiUrl); }, [settings.apiUrl]);
  useEffect(() => { setProxyUrl(settings.proxyUrl); }, [settings.proxyUrl]);
  const chooseDirectory = () => run(async () => {
    const directory = await api.chooseDirectory();
    if (directory) await api.updateSettings({ downloadDirectory: directory });
  });
  return <section><div className="page-heading compact"><span className="eyebrow">MAKE IT YOURS</span><h1>按照你的习惯。</h1><p>选好下载位置，剩下的交给 SearchGal。</p></div>
    <div className="settings-card"><h2><FolderOpen size={19} />下载位置</h2><p className="setting-description">每部作品会保存到独立的文件夹。</p><div className="directory-field"><span title={settings.downloadDirectory}>{settings.downloadDirectory}</span><button className="secondary small" onClick={chooseDirectory}>更改<ChevronRight size={14} /></button></div></div>
    <div className="settings-card"><h2><Bell size={19} />提醒与启动</h2>
      <label className="setting-row"><span><strong>下载完成时通知我</strong><small>所有必需文件下载完成后，发送桌面通知。</small></span><input type="checkbox" className="switch" checked={settings.notifications} onChange={event => run(() => api.updateSettings({ notifications: event.target.checked }))} /></label>
      <label className="setting-row"><span><strong><Volume2 size={15} />通知声音</strong><small>完成通知使用系统提示音。</small></span><input type="checkbox" className="switch" checked={settings.sound} onChange={event => run(() => api.updateSettings({ sound: event.target.checked }))} /></label>
      <label className="setting-row"><span><strong><Power size={15} />开机启动</strong><small>{snapshot.packaged ? '登录电脑时启动 SearchGal。' : '安装版中可以开启。'}</small></span><input type="checkbox" className="switch" disabled={!snapshot.packaged} checked={settings.launchAtLogin} onChange={event => run(() => api.updateSettings({ launchAtLogin: event.target.checked }))} /></label>
    </div>
    <div className="settings-card"><h2><Globe size={19} />网络设置</h2><p className="setting-description">默认在本机搜索资源。需要时，可以连接自己的搜索服务或 HTTP 代理。</p>
      <form onSubmit={event => { event.preventDefault(); run(async () => { await api.updateSettings({ apiUrl, proxyUrl }); setSaved(true); }); }}>
        <label className="field-label">搜索服务地址 <span>可选</span><input type="url" placeholder="留空使用本地搜索" value={apiUrl} onChange={event => { setApiUrl(event.target.value); setSaved(false); }} /></label>
        <label className="field-label">HTTP 代理地址 <span>可选</span><input type="url" placeholder="例如 http://127.0.0.1:7890" value={proxyUrl} onChange={event => { setProxyUrl(event.target.value); setSaved(false); }} /></label>
        <div className="settings-save"><small>新任务使用保存后的网络设置。</small><button className="secondary" type="submit">{saved ? '已保存' : '保存网络设置'}</button></div>
      </form>
    </div>
    <LLMSettings snapshot={snapshot} run={run} />
    <p className="footnote">SearchGal {snapshot.version} · 搜索与下载在本机后台运行。</p>
  </section>;
}

function LLMSettings({ snapshot, run }: { snapshot: AppSnapshot; run: RunAction }) {
  const current = snapshot.settings.llm;
  const [draft, setDraft] = useState(current);
  const [apiKey, setApiKey] = useState('');
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  useEffect(() => { setDraft(current); }, [current.enabled, current.baseURL, current.model, current.timeoutMs, current.failureMode]);
  const change = (value: Partial<typeof draft>) => { setDraft(previous => ({ ...previous, ...value })); setSaved(false); };
  return <div className="llm-settings">
    <h2><KeyRound size={19} />解压密码检查</h2>
    <form onSubmit={event => {
      event.preventDefault();
      run(async () => {
        setSaving(true);
        try { await api.updateLLMSettings(draft, apiKey || undefined); setApiKey(''); setSaved(true); }
        finally { setSaving(false); }
      });
    }}>
      <label className="setting-row"><span><strong>启用 LLM 检查</strong><small>开启后，资源网页片段会发送至下面配置的模型服务。</small></span><input type="checkbox" className="switch" checked={draft.enabled} onChange={event => change({ enabled: event.target.checked })} /></label>
      <label className="field-label">LLM 接口地址<input type="url" required value={draft.baseURL} placeholder="https://api.deepseek.com/v1" onChange={event => change({ baseURL: event.target.value })} /></label>
      <div className="llm-fields">
        <label className="field-label">模型名称<input required maxLength={200} value={draft.model} onChange={event => change({ model: event.target.value })} /></label>
        <label className="field-label">请求超时（秒）<input type="number" required min={1} max={120} step={1} value={draft.timeoutMs / 1000 || ''} onChange={event => change({ timeoutMs: Number(event.target.value) * 1000 })} /></label>
      </div>
      <label className="field-label">API Key <span>{snapshot.llmKeyConfigured ? '已配置 · 加密保存' : '未配置'}</span><input type="password" autoComplete="off" spellCheck={false} maxLength={8192} value={apiKey} placeholder={snapshot.llmKeyConfigured ? '留空保留现有 Key' : '输入 API Key'} onChange={event => { setApiKey(event.target.value); setSaved(false); }} /></label>
      <label className="field-label">密码检查策略<select value={draft.failureMode} onChange={event => change({ failureMode: event.target.value as typeof draft.failureMode })}>
        <option value="continue">预警后继续下载</option><option value="skip">严格模式：有障碍或检查失败时跳过</option>
      </select></label>
      <div className="settings-save"><small role="status">{saved ? 'LLM 设置已保存' : '新启动的下载使用这些设置'}</small><div className="llm-actions">
        <button className="icon-button" type="button" disabled={!snapshot.llmKeyConfigured || saving} title="删除 API Key" aria-label="删除 API Key" onClick={() => run(async () => {
          setSaving(true);
          try { await api.updateLLMSettings(current, ''); setApiKey(''); setSaved(false); }
          finally { setSaving(false); }
        })}><Trash2 size={16} /></button>
        <button className="secondary" type="submit" disabled={saving}><Save size={15} />{saving ? '保存中' : '保存 LLM 设置'}</button>
      </div></div>
    </form>
  </div>;
}
