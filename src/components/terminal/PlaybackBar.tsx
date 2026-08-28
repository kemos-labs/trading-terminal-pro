import { useTerminalStore } from '../../store/terminalStore';
import { fmtTime } from '../../lib/format';

export function PlaybackBar() {
  const { historicalFrames, frameIndex, isPlaying, speed, setFrameIndex, togglePlay, setSpeed } = useTerminalStore();

  if (historicalFrames.length < 2) return null;

  return (
    <div 
      className="flex h-9 items-center gap-2 border-t border-border bg-card px-3 text-xs font-mono"
      role="toolbar"
      aria-label="Historical playback controls"
    >
      <button
        onClick={() => setFrameIndex(Math.max(0, frameIndex - 1))}
        className="text-muted-foreground hover:text-foreground px-1"
        disabled={frameIndex <= 0}
        aria-label="Previous frame"
        aria-describedby="frame-counter"
      >
        ⏮
      </button>
      <button
        onClick={togglePlay}
        className="text-foreground hover:text-foreground/80 px-1 font-bold"
        aria-label={isPlaying ? 'Pause playback' : 'Start playback'}
      >
        {isPlaying ? '⏸' : '▶'}
      </button>
      <button
        onClick={() => setFrameIndex(Math.min(historicalFrames.length - 1, frameIndex + 1))}
        className="text-muted-foreground hover:text-foreground px-1"
        disabled={frameIndex >= historicalFrames.length - 1}
        aria-label="Next frame"
        aria-describedby="frame-counter"
      >
        ⏭
      </button>

      <input
        type="range"
        min={0}
        max={historicalFrames.length - 1}
        value={frameIndex}
        onChange={e => setFrameIndex(Number(e.target.value))}
        className="vt-scrubber flex-1 h-1 cursor-pointer"
        aria-label="Historical timeline scrubber"
        aria-valuemin={0}
        aria-valuemax={historicalFrames.length - 1}
        aria-valuenow={frameIndex}
      />

      <span 
        className="text-muted-foreground tabular-nums w-16 text-right"
        aria-live="polite"
        aria-atomic="true"
      >
        {fmtTime(historicalFrames[frameIndex]?.timestamp ?? Date.now())}
      </span>

      <span 
        className="text-muted-foreground"
        id="frame-counter"
        aria-live="polite"
      >
        {frameIndex + 1}/{historicalFrames.length}
      </span>

      {isPlaying && <span className="text-muted-foreground text-type-xs" aria-live="polite">LIVE EDGE</span>}

      <select
        value={speed}
        onChange={e => setSpeed(Number(e.target.value))}
        className="bg-transparent border border-border rounded px-1 text-type-xs text-muted-foreground"
        aria-label="Playback speed"
      >
        <option value={0.5}>0.5x</option>
        <option value={1}>1x</option>
        <option value={2}>2x</option>
        <option value={4}>4x</option>
      </select>
    </div>
  );
}
