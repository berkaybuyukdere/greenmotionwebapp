import React, { useEffect, useState } from 'react';
import { BookOpen, X } from 'lucide-react';
import { PalantirPageIcon } from './palantir/PalantirNavIcon';
import {
    TURKEY_DOC_TOPICS,
    readTurkeyDocsLanguage,
    turkeyDocsTopic,
    turkeyDocsUi,
    writeTurkeyDocsLanguage,
} from '../utilities/turkeyFeatureDocumentation';

function useTurkeyDocsLanguage() {
    const [lang, setLangState] = useState(() => readTurkeyDocsLanguage());

    const setLang = (next) => {
        const normalized = writeTurkeyDocsLanguage(next);
        setLangState(normalized);
    };

    useEffect(() => {
        const onStorage = (e) => {
            if (e.key === 'AppLanguage') {
                setLangState(readTurkeyDocsLanguage());
            }
        };
        window.addEventListener('storage', onStorage);
        return () => window.removeEventListener('storage', onStorage);
    }, []);

    return [lang, setLang];
}

export function TurkeyDocumentationButton({ topicId, className = '' }) {
    const [open, setOpen] = useState(false);
    const ui = turkeyDocsUi(readTurkeyDocsLanguage());

    return (
        <>
            <button
                type="button"
                onClick={() => setOpen(true)}
                className={`pal-btn pal-btn-sm inline-flex items-center gap-1.5 ${className}`.trim()}
                title={ui.title}
                aria-label={ui.title}
            >
                <BookOpen size={15} />
                <span className="hidden sm:inline">{ui.title}</span>
            </button>
            {open && (
                <TurkeyDocumentationPanel topicId={topicId} onClose={() => setOpen(false)} />
            )}
        </>
    );
}

export function TurkeyDocumentationPanel({ topicId, onClose }) {
    const [lang, setLang] = useTurkeyDocsLanguage();
    const ui = turkeyDocsUi(lang);
    const topic = turkeyDocsTopic(lang, topicId);

    useEffect(() => {
        const onKey = (e) => {
            if (e.key === 'Escape') onClose?.();
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [onClose]);

    if (!topic) return null;

    return (
        <div
            className="pal-wb-overlay"
            onClick={(e) => e.target === e.currentTarget && onClose?.()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="turkey-doc-title"
        >
            <div
                className="pal-modal w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col m-4"
                onClick={(e) => e.stopPropagation()}
            >
                <header className="flex items-start justify-between gap-3 px-sap-5 py-sap-4 border-b border-[var(--erpx-border)]">
                    <div className="min-w-0">
                        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--erpx-ink-muted)]">
                            {ui.title}
                        </p>
                        <h2 id="turkey-doc-title" className="text-section-title mt-1">
                            {topic.title}
                        </h2>
                        <p className="text-caption mt-1 text-[var(--erpx-ink-secondary)]">{topic.subtitle}</p>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        className="gm-btn gm-btn-ghost gm-btn-sm shrink-0"
                        aria-label={ui.close}
                    >
                        <X size={18} />
                    </button>
                </header>

                <div className="px-sap-5 py-sap-3 border-b border-[var(--erpx-border)] bg-[var(--erpx-surface-alt,var(--erpx-surface))]">
                    <label className="text-caption font-semibold text-[var(--erpx-ink-secondary)]">
                        {ui.languageLabel}
                    </label>
                    <div className="flex flex-wrap gap-2 mt-2">
                        {[
                            { id: 'en', label: 'English' },
                            { id: 'tr', label: 'Türkçe' },
                            { id: 'de', label: 'Deutsch' },
                        ].map((opt) => (
                            <button
                                key={opt.id}
                                type="button"
                                onClick={() => setLang(opt.id)}
                                className={`pal-btn pal-btn-sm ${lang === opt.id ? 'pal-btn-primary' : ''}`}
                            >
                                {opt.label}
                            </button>
                        ))}
                    </div>
                </div>

                <div className="overflow-y-auto px-sap-5 py-sap-4 space-y-sap-4 flex-1">
                    {topic.sections.map((section) => (
                        <article
                            key={section.title}
                            className="rounded-sap-sm border border-[var(--erpx-border)] bg-[var(--erpx-surface)] p-sap-4"
                        >
                            <h3 className="text-card-title">{section.title}</h3>
                            <p className="text-body-sm text-[var(--erpx-ink-secondary)] mt-sap-2 leading-relaxed">
                                {section.body}
                            </p>
                            {section.bullets?.length > 0 && (
                                <ul className="mt-sap-3 space-y-1.5 text-body-sm text-[var(--erpx-ink)]">
                                    {section.bullets.map((bullet) => (
                                        <li key={bullet} className="flex gap-2">
                                            <span className="text-[var(--erpx-brand)] shrink-0">•</span>
                                            <span>{bullet}</span>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </article>
                    ))}
                </div>
            </div>
        </div>
    );
}

export function TurkeyDocumentationSettingsSection({ onOpenTopic }) {
    const [lang, setLang] = useTurkeyDocsLanguage();
    const ui = turkeyDocsUi(lang);

    return (
        <div className="bg-sap-bg-light dark:bg-sap-bgDark-dark border border-sap-border-light dark:border-sap-borderDark-light rounded-sap-sm p-sap-5 space-y-sap-4">
            <div>
                <h3 className="text-card-title">{ui.settingsSection}</h3>
                <p className="text-caption mt-sap-1">{ui.settingsFooter}</p>
            </div>

            <div>
                <label className="text-caption font-semibold text-sap-text-secondary dark:text-sap-textDark-secondary">
                    {ui.languageLabel}
                </label>
                <div className="flex flex-wrap gap-2 mt-2">
                    {[
                        { id: 'en', label: 'English' },
                        { id: 'tr', label: 'Türkçe' },
                        { id: 'de', label: 'Deutsch' },
                    ].map((opt) => (
                        <button
                            key={opt.id}
                            type="button"
                            onClick={() => setLang(opt.id)}
                            className={`pal-btn pal-btn-sm ${lang === opt.id ? 'pal-btn-primary' : ''}`}
                        >
                            {opt.label}
                        </button>
                    ))}
                </div>
            </div>

            <div className="space-y-2">
                <p className="text-caption font-semibold uppercase tracking-wide text-sap-text-secondary dark:text-sap-textDark-secondary">
                    {ui.listHeader}
                </p>
                {TURKEY_DOC_TOPICS.map((topic) => {
                    const meta = turkeyDocsTopic(lang, topic.id);
                    if (!meta) return null;
                    return (
                        <button
                            key={topic.id}
                            type="button"
                            onClick={() => onOpenTopic?.(topic.id)}
                            className="w-full flex items-center gap-3 px-sap-3 py-sap-3 rounded-sap-sm border border-sap-border-light dark:border-sap-borderDark-light hover:bg-sap-bg-lightAlt dark:hover:bg-sap-bgDark-darkAlt text-left transition-colors"
                        >
                            <PalantirPageIcon navKey={topic.icon} />
                            <span className="min-w-0 flex-1">
                                <span className="block text-sap-sm font-semibold">{meta.title}</span>
                                <span className="block text-caption text-sap-text-secondary dark:text-sap-textDark-secondary truncate">
                                    {meta.subtitle}
                                </span>
                            </span>
                            <span className="text-caption text-[var(--erpx-brand)] shrink-0">{ui.openGuide}</span>
                        </button>
                    );
                })}
            </div>
            <p className="text-caption text-sap-text-secondary dark:text-sap-textDark-secondary">{ui.listFooter}</p>
        </div>
    );
}
