import { useEffect, useRef, useState, type RefObject } from 'react';
import type { Character } from '../../shared/contracts';
import { characterImageFormat, characterImageTypes } from '../../shared/character-images';
import { characterUrl } from './lib';

/** Paint the decoded frame and its hit mask together; drawing an animated <img> to canvas only yields its first frame. */
export function useCharacterAnimation(
  character: Character | undefined,
  canvasRef: RefObject<HTMLCanvasElement | null>,
  onFrame: (canvas: HTMLCanvasElement) => void,
): string {
  const [failure, setFailure] = useState<{ id: string; message: string }>();
  const frameCallback = useRef(onFrame);
  frameCallback.current = onFrame;

  useEffect(() => {
    setFailure(undefined);
    const canvas = canvasRef.current;
    if (!character || !canvas) return;
    const controller = new AbortController();
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const context = canvas.getContext('2d')!;
    let decoder: ImageDecoder | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let live = true;
    let ready = false;
    let failed = false;
    let generation = 0;
    let index = 0;
    let frameCount = 0;

    const stop = () => { generation++; clearTimeout(timer); };
    const fail = () => {
      stop();
      failed = true;
      decoder?.close();
      decoder = undefined;
      setFailure({ id: character.id, message: '这段动画暂时无法播放，点这里重新选择。' });
    };
    const advance = async (current: number) => {
      if (!live || current !== generation || document.hidden || !decoder) return;
      let frame: VideoFrame | undefined;
      const started = performance.now();
      try {
        frame = (await decoder.decode({ frameIndex: index })).image;
        if (!live || current !== generation) return;
        if (canvas.width !== frame.displayWidth) canvas.width = frame.displayWidth;
        if (canvas.height !== frame.displayHeight) canvas.height = frame.displayHeight;
        context.clearRect(0, 0, canvas.width, canvas.height);
        context.drawImage(frame, 0, 0, canvas.width, canvas.height);
        frameCallback.current(canvas);
        index = (index + 1) % frameCount;
        if (!reducedMotion.matches && frameCount > 1) {
          const duration = Math.max(20, (frame.duration ?? 100_000) / 1000);
          timer = setTimeout(() => { void advance(current); }, Math.max(0, duration - (performance.now() - started)));
        }
      } catch {
        if (live && current === generation) fail();
      } finally { frame?.close(); }
    };
    const restart = () => {
      stop();
      index = 0;
      if (ready && !failed) void advance(generation);
    };

    reducedMotion.addEventListener('change', restart);
    document.addEventListener('visibilitychange', restart);
    void (async () => {
      try {
        const response = await fetch(characterUrl(character.id), { signal: controller.signal });
        if (!response.ok) throw new Error('Image unavailable');
        const data = await response.arrayBuffer();
        if (!live) return;
        const scale = Math.min(1, 720 / Math.max(character.width, character.height));
        decoder = new ImageDecoder({
          data, type: characterImageTypes[characterImageFormat(character.image)!], preferAnimation: true,
          desiredWidth: Math.max(1, Math.round(character.width * scale)),
          desiredHeight: Math.max(1, Math.round(character.height * scale)),
        });
        await decoder.tracks.ready;
        if (!live) return;
        frameCount = decoder.tracks.selectedTrack?.frameCount ?? 0;
        if (!frameCount) throw new Error('Image has no frames');
        ready = true;
        restart();
      } catch { if (live) fail(); }
    })();

    return () => {
      live = false;
      stop();
      controller.abort();
      reducedMotion.removeEventListener('change', restart);
      document.removeEventListener('visibilitychange', restart);
      decoder?.close();
    };
  }, [character?.id, character?.image, canvasRef]);

  return failure && failure.id === character?.id ? failure.message : '';
}
