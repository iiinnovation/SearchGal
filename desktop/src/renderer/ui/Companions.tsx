import { useEffect, useState } from 'react';
import { Plus, Check, Trash2, Heart, ImagePlus } from 'lucide-react';
import type { AppSnapshot } from '../../shared/contracts';
import { api, characterUrl, type RunAction } from './lib';

export function CompanionsView({ snapshot, run }: { snapshot: AppSnapshot; run: RunAction }) {
  const [nickname, setNickname] = useState(snapshot.settings.nickname);
  useEffect(() => { setNickname(snapshot.settings.nickname); }, [snapshot.settings.nickname]);
  return <section><div className="page-heading compact"><span className="eyebrow">A LITTLE COMPANY</span><h1>让喜欢的角色，陪在桌面。</h1><p>添加透明立绘或动图，让它陪你等待下载完成。</p></div>
    <div className="section-heading"><div><h2>我的角色 <span className="count">{snapshot.characters.length}</span></h2><p>图片会保存一份副本，原始文件不受影响。</p></div><button className="primary" onClick={() => run(() => api.importCharacter())}><Plus size={17} />导入角色</button></div>
    {snapshot.characters.length === 0 ? <button className="character-empty" onClick={() => run(() => api.importCharacter())}><span className="image-add"><ImagePlus size={34} strokeWidth={1.2} /></span><strong>添加第一位伙伴</strong><span>支持透明 PNG、GIF 和 WebP 动图</span><small>最大 10 MB · 最高 4096 × 4096 像素</small></button> : <div className="character-grid">{snapshot.characters.map(character => <article className={`character-card ${snapshot.settings.characterId === character.id ? 'chosen' : ''}`} key={character.id}>
      <button className="character-select" onClick={() => run(() => api.updateSettings({ characterId: character.id, petVisible: true }))} aria-label={`选择 ${character.name}`}>
        <span className="portrait-stage"><img src={characterUrl(character.id, true)} alt={character.name} /></span><strong>{character.name}</strong>{(character.frameCount ?? 1) > 1 && <small className="character-animation-label">循环动图</small>}{snapshot.settings.characterId === character.id && <span className="character-check"><Check size={13} />正在陪伴</span>}
      </button><button className="character-delete icon-button" aria-label={`移除 ${character.name}`} title="移除导入的副本" onClick={() => run(() => api.removeCharacter(character.id))}><Trash2 size={14} /></button>
    </article>)}</div>}
    <p className="footnote">支持 PNG、GIF 和 WebP，最大 10 MB。建议使用 3–5 秒的透明循环动图；开启系统“减少动态效果”时显示静止画面。</p>
    <div className="settings-card"><h2><Heart size={19} />陪伴方式</h2><label className="setting-row"><span><strong>显示桌面伙伴</strong><small>也可以在系统托盘中显示或隐藏。</small></span><input type="checkbox" className="switch" disabled={!snapshot.characters.length} checked={snapshot.settings.petVisible && Boolean(snapshot.characters.length)} onChange={event => run(() => api.updateSettings({ petVisible: event.target.checked }))} /></label>
      <form className="nickname-form" onSubmit={event => { event.preventDefault(); run(() => api.updateSettings({ nickname })); }}><label className="field-label">伙伴昵称<input value={nickname} maxLength={24} onChange={event => setNickname(event.target.value)} /></label><button type="submit" className="secondary small">保存昵称</button></form>
      <label className="setting-row"><span><strong>角色大小</strong><small>拖动角色可以调整桌面位置。</small></span><select aria-label="角色大小" value={snapshot.settings.petSize} onChange={event => run(() => api.updateSettings({ petSize: Number(event.target.value) }))}>{[120, 160, 180, 220, 260, 300, 360].map(size => <option key={size} value={size}>{size} px</option>)}</select></label>
    </div>
  </section>;
}
