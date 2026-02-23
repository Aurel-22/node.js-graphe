import React, { useEffect, useRef, useState, useCallback } from 'react';
import './FpsCounter.css';

interface FpsCounterProps {
  /** When true, the counter is "recording" – shows a red dot and tracks min/max */
  recording?: boolean;
}

const HISTORY_SIZE = 120; // keep 120 samples (~60s at 2 samples/s)
const SAMPLE_INTERVAL = 250; // ms between FPS updates

const FpsCounter: React.FC<FpsCounterProps> = ({ recording = false }) => {
  const [fps, setFps] = useState(0);
  const [minFps, setMinFps] = useState<number>(Infinity);
  const [maxFps, setMaxFps] = useState<number>(0);
  const [avgFps, setAvgFps] = useState<number>(0);
  const [expanded, setExpanded] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const historyRef = useRef<number[]>([]);
  const frameCountRef = useRef(0);
  const lastSampleRef = useRef(performance.now());
  const animFrameRef = useRef<number>(0);
  const recordingRef = useRef(recording);

  // Keep ref in sync
  useEffect(() => {
    // Reset min/max when recording starts
    if (recording && !recordingRef.current) {
      setMinFps(Infinity);
      setMaxFps(0);
      historyRef.current = [];
    }
    recordingRef.current = recording;
  }, [recording]);

  // Draw sparkline on canvas
  const drawSparkline = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    const history = historyRef.current;

    ctx.clearRect(0, 0, w, h);

    if (history.length < 2) return;

    // Background grid
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    for (const y of [15, 30, 45, 60]) {
      const py = h - (y / 80) * h;
      ctx.beginPath();
      ctx.moveTo(0, py);
      ctx.lineTo(w, py);
      ctx.stroke();
    }

    // FPS labels
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.font = '8px monospace';
    ctx.textAlign = 'right';
    for (const y of [15, 30, 60]) {
      const py = h - (y / 80) * h;
      ctx.fillText(`${y}`, w - 2, py - 2);
    }

    // Draw area + line
    const maxVal = 80;
    const step = w / (HISTORY_SIZE - 1);
    const startIdx = Math.max(0, history.length - HISTORY_SIZE);
    const visible = history.slice(startIdx);

    // Area fill
    ctx.beginPath();
    ctx.moveTo(0, h);
    visible.forEach((val, i) => {
      const x = i * step;
      const y = h - (Math.min(val, maxVal) / maxVal) * h;
      ctx.lineTo(x, y);
    });
    ctx.lineTo((visible.length - 1) * step, h);
    ctx.closePath();

    const gradient = ctx.createLinearGradient(0, 0, 0, h);
    gradient.addColorStop(0, 'rgba(76, 175, 80, 0.3)');
    gradient.addColorStop(0.5, 'rgba(255, 193, 7, 0.15)');
    gradient.addColorStop(1, 'rgba(244, 67, 54, 0.05)');
    ctx.fillStyle = gradient;
    ctx.fill();

    // Line
    ctx.beginPath();
    visible.forEach((val, i) => {
      const x = i * step;
      const y = h - (Math.min(val, maxVal) / maxVal) * h;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = getFpsColor(visible[visible.length - 1] ?? 60);
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Current value dot
    if (visible.length > 0) {
      const lastX = (visible.length - 1) * step;
      const lastY = h - (Math.min(visible[visible.length - 1], maxVal) / maxVal) * h;
      ctx.beginPath();
      ctx.arc(lastX, lastY, 3, 0, Math.PI * 2);
      ctx.fillStyle = getFpsColor(visible[visible.length - 1]);
      ctx.fill();
    }
  }, []);

  // Main rAF loop
  useEffect(() => {
    const loop = () => {
      frameCountRef.current++;
      const now = performance.now();
      const delta = now - lastSampleRef.current;

      if (delta >= SAMPLE_INTERVAL) {
        const currentFps = Math.round((frameCountRef.current / delta) * 1000);
        frameCountRef.current = 0;
        lastSampleRef.current = now;

        setFps(currentFps);
        historyRef.current.push(currentFps);
        if (historyRef.current.length > HISTORY_SIZE * 2) {
          historyRef.current = historyRef.current.slice(-HISTORY_SIZE);
        }

        // Update min/max/avg only while recording
        if (recordingRef.current) {
          setMinFps((prev) => Math.min(prev, currentFps));
          setMaxFps((prev) => Math.max(prev, currentFps));
          const hist = historyRef.current;
          const sum = hist.reduce((a, b) => a + b, 0);
          setAvgFps(Math.round(sum / hist.length));
        }

        drawSparkline();
      }

      animFrameRef.current = requestAnimationFrame(loop);
    };

    animFrameRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [drawSparkline]);

  const fpsColor = getFpsColor(fps);

  return (
    <div className={`fps-counter ${expanded ? 'expanded' : ''}`}>
      <div className="fps-header" onClick={() => setExpanded(!expanded)}>
        {recording && <span className="fps-rec-dot" />}
        <span className="fps-value" style={{ color: fpsColor }}>
          {fps}
        </span>
        <span className="fps-label">FPS</span>
        <span className="fps-expand">{expanded ? '▼' : '▶'}</span>
      </div>

      {expanded && (
        <div className="fps-body">
          <canvas
            ref={canvasRef}
            className="fps-sparkline"
            width={200}
            height={60}
          />
          <div className="fps-stats-row">
            <span className="fps-stat">
              Min: <strong style={{ color: getFpsColor(minFps === Infinity ? 0 : minFps) }}>
                {minFps === Infinity ? '–' : minFps}
              </strong>
            </span>
            <span className="fps-stat">
              Avg: <strong style={{ color: getFpsColor(avgFps) }}>
                {avgFps || '–'}
              </strong>
            </span>
            <span className="fps-stat">
              Max: <strong style={{ color: getFpsColor(maxFps) }}>
                {maxFps || '–'}
              </strong>
            </span>
          </div>
        </div>
      )}
    </div>
  );
};

function getFpsColor(fps: number): string {
  if (fps >= 50) return '#4CAF50';
  if (fps >= 30) return '#8BC34A';
  if (fps >= 20) return '#FFC107';
  if (fps >= 10) return '#FF9800';
  return '#F44336';
}

export default FpsCounter;
