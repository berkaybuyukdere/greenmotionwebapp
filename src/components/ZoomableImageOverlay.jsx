import React, { useCallback, useEffect, useRef, useState } from 'react';
import { X, ChevronLeft, ChevronRight } from 'lucide-react';

/**
 * Fullscreen photo overlay with mouse-wheel zoom, drag-to-pan and keyboard
 * navigation. Shared by operation detail views (checkout / return / garage)
 * so every photo preview behaves the same way.
 *
 * Interaction contract matches the App.js ImageGallery: wheel = zoom,
 * drag = pan when zoomed, arrows = navigate, 0 = reset, Escape = close.
 */
export default function ZoomableImageOverlay({ images, startIndex = 0, onClose }) {
    const list = Array.isArray(images) ? images.filter(Boolean) : [images].filter(Boolean);
    const [currentIndex, setCurrentIndex] = useState(
        Math.min(Math.max(0, startIndex), Math.max(0, list.length - 1))
    );
    const [zoom, setZoom] = useState(1);
    const [pan, setPan] = useState({ x: 0, y: 0 });
    const [isDragging, setIsDragging] = useState(false);
    const dragStartRef = useRef({ x: 0, y: 0, panX: 0, panY: 0 });
    const viewportRef = useRef(null);

    const clampZoom = (next) => (Number.isFinite(next) ? Math.min(5, Math.max(1, next)) : 1);

    const resetView = useCallback(() => {
        setZoom(1);
        setPan({ x: 0, y: 0 });
    }, []);

    useEffect(() => {
        resetView();
        setIsDragging(false);
    }, [currentIndex, resetView]);

    // Preload neighbours so stepping through large sets stays responsive.
    useEffect(() => {
        for (let d = -1; d <= 1; d++) {
            const url = list[currentIndex + d];
            if (!url) continue;
            const img = new Image();
            img.decoding = 'async';
            img.src = url;
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentIndex]);

    // Wheel zoom must be a non-passive listener so preventDefault reliably
    // stops the page behind the overlay from scrolling.
    useEffect(() => {
        const node = viewportRef.current;
        if (!node) return undefined;
        const onWheel = (e) => {
            e.preventDefault();
            const delta = e.deltaY < 0 ? 0.2 : -0.2;
            setZoom((prev) => clampZoom(Number((prev + delta).toFixed(2))));
        };
        node.addEventListener('wheel', onWheel, { passive: false });
        return () => node.removeEventListener('wheel', onWheel);
    }, []);

    useEffect(() => {
        const onKey = (e) => {
            if (e.key === 'Escape') onClose();
            if (e.key === 'ArrowLeft') setCurrentIndex((i) => Math.max(0, i - 1));
            if (e.key === 'ArrowRight') setCurrentIndex((i) => Math.min(list.length - 1, i + 1));
            if (e.key === '0') resetView();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [list.length, onClose, resetView]);

    const handlePointerDown = (e) => {
        if (zoom <= 1.01) return;
        e.preventDefault();
        setIsDragging(true);
        dragStartRef.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
    };

    const handlePointerMove = (e) => {
        if (!isDragging) return;
        setPan({
            x: dragStartRef.current.panX + (e.clientX - dragStartRef.current.x),
            y: dragStartRef.current.panY + (e.clientY - dragStartRef.current.y),
        });
    };

    const handlePointerUp = () => setIsDragging(false);

    if (!list.length) return null;

    return (
        <div
            className="fixed inset-0 z-[100] bg-black/85 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={onClose}
            role="presentation"
        >
            <button
                type="button"
                className="absolute top-4 right-4 z-10 p-2 rounded-full bg-black/50 text-white hover:bg-black/70 transition-colors"
                onClick={(e) => {
                    e.stopPropagation();
                    onClose();
                }}
                aria-label="Close preview"
            >
                <X size={22} />
            </button>

            <div className="absolute top-4 left-4 z-10 flex items-center gap-2 bg-black/55 rounded-md px-2 py-1 text-white">
                <button
                    type="button"
                    onClick={(e) => {
                        e.stopPropagation();
                        setZoom((prev) => clampZoom(Number((prev - 0.25).toFixed(2))));
                    }}
                    className="hover:text-gray-200 disabled:opacity-50 px-1"
                    disabled={zoom <= 1}
                    aria-label="Zoom out"
                >
                    <span className="text-lg leading-none">-</span>
                </button>
                <span className="text-xs tabular-nums min-w-[52px] text-center">{Math.round(zoom * 100)}%</span>
                <button
                    type="button"
                    onClick={(e) => {
                        e.stopPropagation();
                        setZoom((prev) => clampZoom(Number((prev + 0.25).toFixed(2))));
                    }}
                    className="hover:text-gray-200 disabled:opacity-50 px-1"
                    disabled={zoom >= 5}
                    aria-label="Zoom in"
                >
                    <span className="text-lg leading-none">+</span>
                </button>
                <button
                    type="button"
                    onClick={(e) => {
                        e.stopPropagation();
                        resetView();
                    }}
                    className="text-xs px-2 py-0.5 rounded bg-white/15 hover:bg-white/25"
                >
                    Reset
                </button>
            </div>

            {list.length > 1 && (
                <>
                    <button
                        type="button"
                        onClick={(e) => {
                            e.stopPropagation();
                            setCurrentIndex((i) => Math.max(0, i - 1));
                        }}
                        disabled={currentIndex === 0}
                        className="absolute left-4 z-10 p-2 rounded-full bg-black/50 text-white hover:bg-black/70 disabled:opacity-40 disabled:pointer-events-none transition-colors"
                        aria-label="Previous photo"
                    >
                        <ChevronLeft size={28} />
                    </button>
                    <button
                        type="button"
                        onClick={(e) => {
                            e.stopPropagation();
                            setCurrentIndex((i) => Math.min(list.length - 1, i + 1));
                        }}
                        disabled={currentIndex >= list.length - 1}
                        className="absolute right-4 z-10 p-2 rounded-full bg-black/50 text-white hover:bg-black/70 disabled:opacity-40 disabled:pointer-events-none transition-colors"
                        aria-label="Next photo"
                    >
                        <ChevronRight size={28} />
                    </button>
                    <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 bg-black/55 text-white px-3 py-1.5 rounded-md text-sm tabular-nums">
                        {currentIndex + 1} / {list.length}
                    </div>
                </>
            )}

            <div
                ref={viewportRef}
                className="w-full h-[92vh] flex items-center justify-center overflow-hidden"
                onClick={(e) => e.stopPropagation()}
                onMouseMove={handlePointerMove}
                onMouseUp={handlePointerUp}
                onMouseLeave={handlePointerUp}
                onDoubleClick={() => (zoom > 1.01 ? resetView() : setZoom(2))}
            >
                <img
                    src={list[currentIndex]}
                    alt=""
                    draggable={false}
                    onMouseDown={handlePointerDown}
                    className="select-none rounded-lg"
                    style={{
                        maxWidth: '92vw',
                        maxHeight: '92vh',
                        objectFit: 'contain',
                        transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                        transformOrigin: 'center center',
                        transition: isDragging ? 'none' : 'transform 120ms ease-out',
                        cursor: zoom > 1.01 ? (isDragging ? 'grabbing' : 'grab') : 'zoom-in',
                    }}
                />
            </div>
        </div>
    );
}
