import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { ArrowUpRight, EyeOff } from 'lucide-react';
import type { AppSnapshot } from '../../shared/contracts';
import { api, characterUrl, progress, type RunAction } from './lib';
import { useCharacterAnimation } from './useCharacterAnimation';

export function Pet({ snapshot, run }: { snapshot: AppSnapshot; run: RunAction }) {
  const character = snapshot.characters.find(character => character.id === snapshot.settings.characterId);
  const image = useRef<HTMLImageElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const maskCanvas = useRef<HTMLCanvasElement | undefined>(undefined);
  const mask = useRef<{ data: Uint8ClampedArray; width: number; height: number } | undefined>(undefined);
  const down = useRef<{ x: number; y: number } | undefined>(undefined);
  const pointerPosition = useRef<{ x: number; y: number } | undefined>(undefined);
  const wasInteractive = useRef<boolean | undefined>(undefined);
  const [celebrating, setCelebrating] = useState(false);
  const completed = snapshot.tasks.find(task => task.status === 'completed');
  const task = snapshot.tasks.find(task => ['resolving', 'downloading', 'pausing'].includes(task.status));
  const failed = snapshot.tasks.find(task => task.status === 'failed');
  const searching = snapshot.search.status === 'searching';
  const hasError = snapshot.search.status === 'failed' || Boolean(failed);
  const meter = task ? progress(task) : undefined;

  useEffect(() => {
    if (!completed || Date.now() - Date.parse(completed.updatedAt) > 8000) return;
    setCelebrating(true);
    const timeout = setTimeout(() => setCelebrating(false), 6000);
    return () => clearTimeout(timeout);
  }, [completed?.updatedAt]);

  const isOnCharacter = useCallback((x: number, y: number) => {
    const rect = (canvas.current ?? image.current)?.getBoundingClientRect();
    if (!rect || !mask.current || !rect.width || !rect.height || x < rect.left || y < rect.top || x >= rect.right || y >= rect.bottom) return false;
    const px = Math.floor((x - rect.left) / rect.width * mask.current.width);
    const py = Math.floor((y - rect.top) / rect.height * mask.current.height);
    return mask.current.data[(py * mask.current.width + px) * 4 + 3] > 20;
  }, []);

  const refreshPointer = useCallback(() => {
    const point = pointerPosition.current;
    if (!point || down.current) return;
    const button = document.elementFromPoint(point.x, point.y)?.closest('[data-interactive]');
    const interactive = Boolean(button) || isOnCharacter(point.x, point.y);
    if (interactive !== wasInteractive.current) {
      wasInteractive.current = interactive;
      api.petPointer(interactive);
    }
  }, [isOnCharacter]);

  const updateMask = useCallback((source: CanvasImageSource) => {
    if (!character) return;
    const target = maskCanvas.current ??= document.createElement('canvas');
    const scale = Math.min(1, 256 / Math.max(character.width, character.height));
    const width = Math.max(1, Math.round(character.width * scale));
    const height = Math.max(1, Math.round(character.height * scale));
    if (target.width !== width) target.width = width;
    if (target.height !== height) target.height = height;
    const context = target.getContext('2d', { willReadFrequently: true })!;
    context.clearRect(0, 0, width, height);
    context.drawImage(source, 0, 0, width, height);
    mask.current = { data: context.getImageData(0, 0, width, height).data, width, height };
    // Animation can move opaque pixels under a stationary pointer.
    refreshPointer();
  }, [character?.width, character?.height, refreshPointer]);

  const animated = (character?.frameCount ?? 1) > 1;
  const animationError = useCharacterAnimation(animated ? character : undefined, canvas, updateMask);

  useEffect(() => {
    mask.current = undefined;
    pointerPosition.current = undefined;
    wasInteractive.current = undefined;
    const pointer = (event: MouseEvent) => {
      pointerPosition.current = { x: event.clientX, y: event.clientY };
      refreshPointer();
    };
    const leave = () => { pointerPosition.current = undefined; wasInteractive.current = false; api.petPointer(false); };
    window.addEventListener('mousemove', pointer);
    window.addEventListener('mouseleave', leave);
    return () => { window.removeEventListener('mousemove', pointer); window.removeEventListener('mouseleave', leave); down.current = undefined; api.petDrag('end'); api.petPointer(false); };
  }, [character?.id, refreshPointer]);

  if (!character) return null;
  const message = animationError || (task ? task.status === 'resolving' ? '正在帮你找下载来源…' : task.status === 'pausing' ? '正在保存进度…' : `${task.title} · ${meter?.value === undefined ? '下载中' : `${meter.value.toFixed(0)}%`}`
    : searching ? `正在寻找「${snapshot.search.query}」…` : celebrating ? '下载好啦，去看看吧！'
    : hasError ? '遇到一点问题，点这里看看吧。' : '今天，想找什么游戏？');
  const mode = task ? 'working' : searching ? 'searching' : celebrating ? 'celebrating' : hasError ? 'error' : 'idle';
  const pointerHandlers = {
    onPointerDown: (event: PointerEvent<HTMLImageElement | HTMLCanvasElement>) => {
      if (event.button !== 0 || !isOnCharacter(event.clientX, event.clientY)) return;
      down.current = { x: event.screenX, y: event.screenY };
      event.currentTarget.setPointerCapture(event.pointerId);
      api.petDrag('start');
    },
    onPointerUp: (event: PointerEvent<HTMLImageElement | HTMLCanvasElement>) => {
      const start = down.current; down.current = undefined;
      api.petDrag('end');
      refreshPointer();
      if (start && Math.hypot(event.screenX - start.x, event.screenY - start.y) < 5) run(() => api.showPanel('search'));
    },
    onPointerCancel: () => { down.current = undefined; api.petDrag('end'); refreshPointer(); },
  };

  return <div className={`pet-shell ${mode}`} data-state={mode} style={{ '--pet-size': `${snapshot.settings.petSize}px` } as CSSProperties} onContextMenu={event => { event.preventDefault(); run(() => api.showPanel('companions')); }}>
    <div className="pet-bubble" data-interactive><button onClick={() => run(() => api.showPanel(animationError ? 'companions' : task || celebrating || (!searching && failed) ? 'downloads' : 'search'))}>{message}<ArrowUpRight size={13} /></button><button className="pet-hide" aria-label="隐藏伙伴" onClick={() => run(() => api.updateSettings({ petVisible: false }))}><EyeOff size={13} /></button></div>
    <div className="pet-art-stage">{animated && !animationError
      ? <canvas key={character.id} ref={canvas} className="pet-art" data-animated="true" role="img" aria-label={snapshot.settings.nickname} {...pointerHandlers} />
      : <img key={character.id} ref={image} crossOrigin="anonymous" className="pet-art" src={characterUrl(character.id, true)} alt={snapshot.settings.nickname} draggable={false}
        onLoad={() => { if (image.current) updateMask(image.current); }}
        onError={() => { mask.current = undefined; api.petPointer(false); }} {...pointerHandlers} />
    }</div><div className="pet-name">{snapshot.settings.nickname}</div>
  </div>;
}
