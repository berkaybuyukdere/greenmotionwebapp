import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { format } from 'date-fns';
import { Calendar, ChevronLeft, ChevronRight } from 'lucide-react';

const parseInputDate = (value) => {
    if (!value) return null;
    const [year, month, day] = String(value).split('-').map(Number);
    if (!year || !month || !day) return null;
    const date = new Date(year, month - 1, day);
    return Number.isNaN(date.getTime()) ? null : date;
};

const toInputValue = (date) => format(date, 'yyyy-MM-dd');

const buildMonthCells = (monthDate) => {
    const year = monthDate.getFullYear();
    const month = monthDate.getMonth();
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const cells = [];

    for (let i = 0; i < firstDay; i += 1) cells.push(null);
    for (let day = 1; day <= daysInMonth; day += 1) cells.push(new Date(year, month, day));
    while (cells.length % 7 !== 0) cells.push(null);

    return cells;
};

const POPOVER_WIDTH = 300;
const POPOVER_EST_HEIGHT = 340;

export function UnifiedDatePicker({
    value = '',
    onChange,
    min,
    max,
    disabled = false,
    allowFutureDates = true,
    clearable = false,
    className = '',
    placement = 'below',
    size = 'default',
    /** When true (default), selecting a day applies immediately — no Apply button */
    instantApply = true,
    variant = 'palantir',
}) {
    const [isOpen, setIsOpen] = useState(false);
    const [monthCursor, setMonthCursor] = useState(() => {
        const base = parseInputDate(value) || new Date();
        return new Date(base.getFullYear(), base.getMonth(), 1);
    });
    const [popoverStyle, setPopoverStyle] = useState(null);
    const rootRef = useRef(null);
    const triggerRef = useRef(null);
    const panelRef = useRef(null);

    const todayDate = useMemo(() => {
        const now = new Date();
        return new Date(now.getFullYear(), now.getMonth(), now.getDate());
    }, []);

    const minDate = useMemo(() => parseInputDate(min), [min]);
    const maxDate = useMemo(() => parseInputDate(max), [max]);
    const selectedDate = useMemo(() => parseInputDate(value), [value]);
    const cells = useMemo(() => buildMonthCells(monthCursor), [monthCursor]);

    useEffect(() => {
        if (!isOpen) return;
        const base = parseInputDate(value) || new Date();
        setMonthCursor(new Date(base.getFullYear(), base.getMonth(), 1));
    }, [isOpen, value]);

    const updatePopoverPosition = () => {
        const el = triggerRef.current;
        if (!el) return;
        const rect = el.getBoundingClientRect();
        const spaceBelow = window.innerHeight - rect.bottom;
        const spaceAbove = rect.top;
        const openAbove =
            placement === 'above' ||
            (placement === 'below' && spaceBelow < POPOVER_EST_HEIGHT && spaceAbove > spaceBelow);

        const width = Math.min(POPOVER_WIDTH, window.innerWidth - 16);
        const left = Math.min(Math.max(8, rect.right - width), window.innerWidth - width - 8);

        if (openAbove) {
            setPopoverStyle({
                position: 'fixed',
                left,
                bottom: window.innerHeight - rect.top + 6,
                width,
                zIndex: 250,
            });
        } else {
            setPopoverStyle({
                position: 'fixed',
                left,
                top: rect.bottom + 6,
                width,
                zIndex: 250,
            });
        }
    };

    useLayoutEffect(() => {
        if (!isOpen) {
            setPopoverStyle(null);
            return undefined;
        }
        updatePopoverPosition();
        const onReflow = () => updatePopoverPosition();
        window.addEventListener('resize', onReflow);
        window.addEventListener('scroll', onReflow, true);
        return () => {
            window.removeEventListener('resize', onReflow);
            window.removeEventListener('scroll', onReflow, true);
        };
    }, [isOpen, placement]);

    useEffect(() => {
        const handleOutsideClick = (event) => {
            if (!rootRef.current) return;
            if (panelRef.current && panelRef.current.contains(event.target)) return;
            if (!rootRef.current.contains(event.target)) {
                setIsOpen(false);
            }
        };

        if (isOpen) {
            document.addEventListener('mousedown', handleOutsideClick);
        }

        return () => document.removeEventListener('mousedown', handleOutsideClick);
    }, [isOpen]);

    const isDateDisabled = (date) => {
        if (!date) return true;
        if (!allowFutureDates && date > todayDate) return true;
        if (minDate && date < minDate) return true;
        if (maxDate && date > maxDate) return true;
        return false;
    };

    const commitDate = (dateCell) => {
        const next = toInputValue(dateCell);
        if (onChange) onChange(next);
        setIsOpen(false);
    };

    const applyPreset = (preset) => {
        const today = new Date(todayDate);
        if (preset === 'today') {
            commitDate(today);
            return;
        }
        if (preset === 'yesterday') {
            const yesterday = new Date(today);
            yesterday.setDate(yesterday.getDate() - 1);
            commitDate(yesterday);
        }
    };

    const displayText = selectedDate
        ? format(selectedDate, size === 'sm' ? 'd MMM yyyy' : 'MMM d, yyyy')
        : 'Select date';
    const weekDays = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

    const usePal = variant !== 'legacy';

    const triggerClass = usePal
        ? `pal-date-trigger ${className}`.trim()
          : size === 'lg'
          ? 'w-full min-h-[52px] px-4 py-3 rounded-xl border-2 border-slate-300/95 dark:border-slate-600/85 bg-white dark:bg-slate-900 text-base font-semibold text-slate-900 dark:text-slate-50 shadow-[inset_0_1px_2px_rgba(0,0,0,0.04)] hover:bg-slate-50 dark:hover:bg-slate-800/90 flex items-center justify-between gap-3 transition-colors disabled:opacity-50'
          : size === 'sm'
            ? 'w-full gm-btn gm-btn-secondary gm-btn-sm !justify-between'
            : size === 'fd'
              ? 'w-full px-3 py-2.5 rounded-xl border border-black/[0.12] bg-white text-[15px] text-[#1d1d1f] flex items-center justify-between gap-2 hover:bg-black/[0.02] transition-colors disabled:opacity-50'
              : 'w-full gm-btn gm-btn-secondary !justify-between';

    const popoverPanel = (
        <div
            ref={panelRef}
            className={usePal ? 'pal-date-popover' : 'rounded-[10px] border border-[var(--erpx-border)] bg-[var(--erpx-surface)] p-2.5 shadow-xl'}
            style={popoverStyle || undefined}
            role="dialog"
            aria-label="Choose date"
        >
            <div className={usePal ? 'pal-date-presets' : 'gm-segmented w-full mb-2'}>
                <button
                    type="button"
                    onClick={() => applyPreset('today')}
                    className={usePal ? 'pal-btn pal-btn-sm' : 'gm-segmented-item'}
                >
                    Today
                </button>
                <button
                    type="button"
                    onClick={() => applyPreset('yesterday')}
                    className={usePal ? 'pal-btn pal-btn-sm' : 'gm-segmented-item'}
                >
                    Yesterday
                </button>
            </div>

            <div className={usePal ? 'pal-date-calendar' : 'rounded-[8px] border border-[var(--erpx-border)] p-1.5'}>
                <div className={usePal ? 'pal-date-month' : 'flex items-center justify-between mb-1.5'}>
                    <button
                        type="button"
                        onClick={() => setMonthCursor(new Date(monthCursor.getFullYear(), monthCursor.getMonth() - 1, 1))}
                        className={usePal ? 'pal-btn pal-btn-sm !p-1.5' : 'gm-btn gm-btn-secondary gm-btn-sm !min-h-[24px] !px-1.5'}
                    >
                        <ChevronLeft size={12} />
                    </button>
                    <p className={usePal ? 'pal-date-month-label' : 'text-xs font-semibold text-[var(--erpx-ink)]'}>
                        {format(monthCursor, 'MMMM yyyy')}
                    </p>
                    <button
                        type="button"
                        onClick={() => setMonthCursor(new Date(monthCursor.getFullYear(), monthCursor.getMonth() + 1, 1))}
                        className={usePal ? 'pal-btn pal-btn-sm !p-1.5' : 'gm-btn gm-btn-secondary gm-btn-sm !min-h-[24px] !px-1.5'}
                    >
                        <ChevronRight size={12} />
                    </button>
                </div>

                <div className={usePal ? 'pal-date-weekdays' : 'grid grid-cols-7 gap-0.5'}>
                    {weekDays.map((dayName) => (
                        <div
                            key={dayName}
                            className={
                                usePal
                                    ? 'pal-date-weekday'
                                    : 'text-center text-[10px] text-[var(--erpx-ink-muted)] py-0.5'
                            }
                        >
                            {dayName}
                        </div>
                    ))}
                </div>

                <div className={usePal ? 'pal-date-grid' : 'grid grid-cols-7 gap-0.5'}>
                    {cells.map((dateCell, idx) => {
                        if (!dateCell) {
                            return <div key={`empty-${idx}`} className={usePal ? '' : 'h-7'} />;
                        }
                        const selected = selectedDate && dateCell.getTime() === selectedDate.getTime();
                        const isToday = dateCell.getTime() === todayDate.getTime();
                        const disabledDate = isDateDisabled(dateCell);
                        return (
                            <button
                                type="button"
                                key={toInputValue(dateCell)}
                                disabled={disabledDate}
                                onClick={() => {
                                    if (instantApply) {
                                        commitDate(dateCell);
                                    } else if (onChange) {
                                        onChange(toInputValue(dateCell));
                                    }
                                }}
                                className={
                                    usePal
                                        ? `pal-date-cell ${selected ? 'is-selected' : ''} ${isToday ? 'is-today' : ''}`
                                        : `h-7 rounded text-[11px] transition-colors ${
                                              selected
                                                  ? 'bg-neutral-800 text-white font-semibold dark:bg-neutral-200 dark:text-neutral-900'
                                                  : 'text-[var(--erpx-ink-secondary)] hover:bg-[var(--erpx-subtle)]'
                                          } ${disabledDate ? 'opacity-40 cursor-not-allowed' : ''}`
                                }
                            >
                                {dateCell.getDate()}
                            </button>
                        );
                    })}
                </div>
            </div>

            {(clearable || !instantApply) && (
                <div className={usePal ? 'pal-date-footer' : 'mt-2 flex items-center justify-end gap-2'}>
                    {clearable && (
                        <button
                            type="button"
                            onClick={() => {
                                if (onChange) onChange('');
                                setIsOpen(false);
                            }}
                            className={usePal ? 'pal-btn pal-btn-sm' : 'gm-btn gm-btn-secondary gm-btn-sm'}
                        >
                            Clear
                        </button>
                    )}
                    {!instantApply && (
                        <>
                            <button
                                type="button"
                                onClick={() => setIsOpen(false)}
                                className={usePal ? 'pal-btn pal-btn-sm' : 'gm-btn gm-btn-secondary gm-btn-sm'}
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={() => {
                                    if (onChange) onChange(value);
                                    setIsOpen(false);
                                }}
                                className="gm-btn gm-btn-secondary gm-btn-sm !bg-neutral-800 !text-white"
                            >
                                Apply
                            </button>
                        </>
                    )}
                </div>
            )}
        </div>
    );

    return (
        <div className={`relative ${className}`} ref={rootRef}>
            <button
                ref={triggerRef}
                type="button"
                disabled={disabled}
                onClick={() => setIsOpen((prev) => !prev)}
                className={triggerClass}
            >
                <span className="truncate text-left">{displayText}</span>
                <Calendar
                    size={size === 'lg' ? 20 : size === 'sm' ? 12 : size === 'fd' ? 16 : 13}
                    strokeWidth={2}
                />
            </button>

            {isOpen && popoverStyle && createPortal(popoverPanel, document.body)}
        </div>
    );
}
