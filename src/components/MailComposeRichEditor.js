import React, { useEffect, useRef } from 'react';
import {
    AlignLeft,
    AlignCenter,
    AlignRight,
    List,
    ListOrdered,
    Bold,
    Italic,
    Underline,
    Link2,
} from 'lucide-react';

function applyCommand(command, value) {
    try {
        document.execCommand(command, false, value);
    } catch {
        /* ignore */
    }
}

export function MailComposeRichEditor({ value, onChange, isDark, className = '' }) {
    const editorRef = useRef(null);
    const syncingRef = useRef(false);

    useEffect(() => {
        const el = editorRef.current;
        if (!el) return;
        if (syncingRef.current) return;
        const next = value || '';
        if (el.innerHTML !== next) {
            el.innerHTML = next;
        }
    }, [value]);

    const onInput = () => {
        const el = editorRef.current;
        if (!el) return;
        syncingRef.current = true;
        onChange?.(el.innerHTML);
        queueMicrotask(() => {
            syncingRef.current = false;
        });
    };

    return (
        <div className={`mail-rich-root ${isDark ? 'mail-rich-dark' : ''} ${className}`}>
            <div className="mail-rich-toolbar">
                <select className="mail-rich-select" defaultValue="" onChange={(e) => applyCommand('fontName', e.target.value)}>
                    <option value="" disabled>
                        Font
                    </option>
                    <option value="Arial" style={{ fontFamily: 'Arial, sans-serif' }}>
                        Arial
                    </option>
                    <option value="Helvetica" style={{ fontFamily: 'Helvetica, sans-serif' }}>
                        Helvetica
                    </option>
                    <option value="Verdana" style={{ fontFamily: 'Verdana, sans-serif' }}>
                        Verdana
                    </option>
                    <option value="Trebuchet MS" style={{ fontFamily: '"Trebuchet MS", sans-serif' }}>
                        Trebuchet MS
                    </option>
                    <option value="Georgia" style={{ fontFamily: 'Georgia, serif' }}>
                        Georgia
                    </option>
                    <option value="Times New Roman" style={{ fontFamily: '"Times New Roman", serif' }}>
                        Times New Roman
                    </option>
                    <option value="Garamond" style={{ fontFamily: 'Garamond, serif' }}>
                        Garamond
                    </option>
                    <option value="Courier New" style={{ fontFamily: '"Courier New", monospace' }}>
                        Courier New
                    </option>
                    <option value="Monaco" style={{ fontFamily: 'Monaco, monospace' }}>
                        Monaco
                    </option>
                </select>
                <select className="mail-rich-select" defaultValue="" onChange={(e) => applyCommand('formatBlock', e.target.value)}>
                    <option value="" disabled>
                        Paragraph
                    </option>
                    <option value="P">Paragraph</option>
                    <option value="H1">Heading 1</option>
                    <option value="H2">Heading 2</option>
                    <option value="H3">Heading 3</option>
                </select>
                <select className="mail-rich-select" defaultValue="" onChange={(e) => applyCommand('fontSize', e.target.value)}>
                    <option value="" disabled>
                        Size
                    </option>
                    <option value="2">Small</option>
                    <option value="3">Normal</option>
                    <option value="4">Large</option>
                    <option value="5">XL</option>
                </select>
                <button type="button" className="mail-rich-btn" title="Bold" onClick={() => applyCommand('bold')}>
                    <Bold size={14} />
                </button>
                <button type="button" className="mail-rich-btn" title="Italic" onClick={() => applyCommand('italic')}>
                    <Italic size={14} />
                </button>
                <button type="button" className="mail-rich-btn" title="Underline" onClick={() => applyCommand('underline')}>
                    <Underline size={14} />
                </button>
                <button type="button" className="mail-rich-btn" title="Bulleted list" onClick={() => applyCommand('insertUnorderedList')}>
                    <List size={14} />
                </button>
                <button type="button" className="mail-rich-btn" title="Numbered list" onClick={() => applyCommand('insertOrderedList')}>
                    <ListOrdered size={14} />
                </button>
                <button type="button" className="mail-rich-btn" title="Align left" onClick={() => applyCommand('justifyLeft')}>
                    <AlignLeft size={14} />
                </button>
                <button type="button" className="mail-rich-btn" title="Align center" onClick={() => applyCommand('justifyCenter')}>
                    <AlignCenter size={14} />
                </button>
                <button type="button" className="mail-rich-btn" title="Align right" onClick={() => applyCommand('justifyRight')}>
                    <AlignRight size={14} />
                </button>
                <input
                    className="mail-rich-color"
                    type="color"
                    title="Text color"
                    onChange={(e) => applyCommand('foreColor', e.target.value)}
                />
                <button
                    type="button"
                    className="mail-rich-btn"
                    onClick={() => {
                        const url = window.prompt('Link URL');
                        if (url) applyCommand('createLink', url);
                    }}
                >
                    <Link2 size={14} />
                </button>
            </div>
            <div
                ref={editorRef}
                className="mail-rich-editor"
                contentEditable
                suppressContentEditableWarning
                onInput={onInput}
                data-placeholder="Write your message…"
            />
        </div>
    );
}
