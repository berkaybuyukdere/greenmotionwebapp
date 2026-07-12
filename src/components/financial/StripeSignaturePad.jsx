import React, { useCallback, useRef } from 'react';
import { RotateCcw } from 'lucide-react';

export function StripeSignaturePad({ value, onChange, height = 140, label = 'Signature' }) {
  const canvasRef = useRef(null);
  const drawing = useRef(false);
  const lastPos = useRef({ x: 0, y: 0 });

  const getPos = (e, canvas) => {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    if (e.touches) {
      return {
        x: (e.touches[0].clientX - rect.left) * scaleX,
        y: (e.touches[0].clientY - rect.top) * scaleY,
      };
    }
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  };

  const start = useCallback((e) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    drawing.current = true;
    lastPos.current = getPos(e, canvas);
  }, []);

  const move = useCallback((e) => {
    e.preventDefault();
    if (!drawing.current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const pos = getPos(e, canvas);
    ctx.beginPath();
    ctx.moveTo(lastPos.current.x, lastPos.current.y);
    ctx.lineTo(pos.x, pos.y);
    ctx.strokeStyle = '#1d1d1f';
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
    lastPos.current = pos;
  }, []);

  const end = useCallback(
    (e) => {
      e.preventDefault();
      if (!drawing.current) return;
      drawing.current = false;
      const canvas = canvasRef.current;
      if (!canvas) return;
      onChange?.(canvas.toDataURL('image/png'));
    },
    [onChange],
  );

  const handleClear = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    onChange?.('');
  }, [onChange]);

  return (
    <div className="pal-fin-signature-pad">
      <div className="pal-fin-signature-pad-head">
        <span>{label}</span>
        <button type="button" className="pal-fin-signature-clear" onClick={handleClear} title="Clear signature">
          <RotateCcw size={14} />
          Clear
        </button>
      </div>
      <canvas
        ref={canvasRef}
        width={800}
        height={height * 2}
        style={{ width: '100%', height: `${height}px`, touchAction: 'none' }}
        className="pal-fin-signature-canvas"
        onMouseDown={start}
        onMouseMove={move}
        onMouseUp={end}
        onMouseLeave={end}
        onTouchStart={start}
        onTouchMove={move}
        onTouchEnd={end}
      />
      <small className="pal-fin-hint">
        {value ? 'Signature captured on screen.' : 'Draw signature above (staff or customer on this screen).'}
      </small>
    </div>
  );
}
