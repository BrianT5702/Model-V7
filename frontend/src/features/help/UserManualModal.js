import React, { useEffect, useMemo, useState } from 'react';
import { FaSearch, FaTimes } from 'react-icons/fa';
import ModalOverlay from '../../components/ModalOverlay';
import { useAuth } from '../auth/AuthContext';
import { ROLE_LABELS } from '../auth/authUtils';
import {
    HELP_ROLE_OPTIONS,
    MANUAL_GROUPS,
    searchManualSections,
} from './userManualContent';

const ROLE_TAB_CLASSES = {
    admin: 'text-indigo-800 bg-indigo-50 border-indigo-200 dark:text-indigo-100 dark:bg-indigo-950/50 dark:border-indigo-700',
    drafter: 'text-blue-800 bg-blue-50 border-blue-200 dark:text-blue-100 dark:bg-blue-950/50 dark:border-blue-700',
    salesman: 'text-amber-800 bg-amber-50 border-amber-200 dark:text-amber-100 dark:bg-amber-950/50 dark:border-amber-700',
    guest: 'text-gray-800 bg-gray-50 border-gray-300 dark:text-gray-100 dark:bg-gray-800 dark:border-gray-600',
};

const Block = ({ block }) => {
    if (block.type === 'img') {
        return (
            <figure className="my-2">
                <img
                    src={block.src}
                    alt={block.alt || ''}
                    className="w-full rounded-lg border border-gray-200 dark:border-gray-700"
                />
                {block.caption ? (
                    <figcaption className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
                        {block.caption}
                    </figcaption>
                ) : null}
            </figure>
        );
    }
    if (block.type === 'p') {
        return <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">{block.text}</p>;
    }
    if (block.type === 'h3') {
        return <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mt-4 mb-1">{block.text}</h3>;
    }
    if (block.type === 'note') {
        return (
            <p className="text-sm text-amber-800 dark:text-amber-200 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2">
                {block.text}
            </p>
        );
    }
    if (block.type === 'ul') {
        return (
            <ul className="list-disc pl-5 space-y-1 text-sm text-gray-700 dark:text-gray-300">
                {block.items.map((item, index) => (
                    <li key={index}>{item}</li>
                ))}
            </ul>
        );
    }
    if (block.type === 'steps') {
        return (
            <ol className="list-decimal pl-5 space-y-1 text-sm text-gray-700 dark:text-gray-300">
                {block.items.map((item, index) => (
                    <li key={index}>{item}</li>
                ))}
            </ol>
        );
    }
    if (block.type === 'table') {
        return (
            <div className="overflow-x-auto border border-gray-200 dark:border-gray-700 rounded-lg">
                <table className="w-full text-sm text-left">
                    <thead className="bg-gray-50 dark:bg-gray-800 text-gray-600 dark:text-gray-300">
                        <tr>
                            {block.headers.map((header) => (
                                <th key={header} className="px-3 py-2 font-medium whitespace-nowrap">
                                    {header}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {block.rows.map((row, rowIndex) => (
                            <tr key={rowIndex} className="border-t border-gray-200 dark:border-gray-700 align-top">
                                {row.map((cell, index) => (
                                    <td
                                        key={index}
                                        className={`px-3 py-2 text-gray-700 dark:text-gray-300 ${index === 0 ? 'font-medium text-gray-900 dark:text-gray-100 whitespace-nowrap' : ''}`}
                                    >
                                        {cell}
                                    </td>
                                ))}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        );
    }
    return null;
};

const UserManualModal = ({ onClose }) => {
    const { isAuthenticated, role } = useAuth();
    const accountRole = isAuthenticated && role ? role : 'guest';
    const [viewRole, setViewRole] = useState(accountRole);
    const [query, setQuery] = useState('');
    const [activeId, setActiveId] = useState('intro');

    useEffect(() => {
        setViewRole(accountRole);
    }, [accountRole]);

    const matches = useMemo(() => searchManualSections(query, viewRole), [query, viewRole]);
    const active = matches.find((section) => section.id === activeId) || matches[0] || null;

    useEffect(() => {
        if (active && active.id !== activeId) {
            setActiveId(active.id);
        }
    }, [active, activeId]);

    useEffect(() => {
        const onKey = (event) => {
            if (event.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose]);

    const grouped = MANUAL_GROUPS.map((group) => ({
        ...group,
        sections: matches.filter((section) => section.group === group.id),
    })).filter((group) => group.sections.length > 0);

    const accountLabel = ROLE_LABELS[accountRole] || 'Guest';
    const viewLabel = ROLE_LABELS[viewRole] || (viewRole === 'guest' ? 'Guest' : viewRole);
    const isPreview = viewRole !== accountRole;

    return (
        <ModalOverlay
            className="bg-black/50 flex items-center justify-center z-[13000] p-3 sm:p-6"
            onClick={(event) => {
                if (event.target === event.currentTarget) onClose();
            }}
        >
            <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 w-full max-w-5xl h-[min(90vh,820px)] flex flex-col overflow-hidden">
                <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-gray-200 dark:border-gray-700">
                    <div className="min-w-0">
                        <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">User manual</h2>
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                            {isPreview
                                ? `Previewing ${viewLabel} Help — your account is ${accountLabel}`
                                : `Showing Help for your ${accountLabel} account`}
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        className="p-1.5 rounded-md text-gray-500 hover:text-gray-800 hover:bg-gray-100 dark:hover:text-white dark:hover:bg-gray-800"
                        aria-label="Close"
                    >
                        <FaTimes />
                    </button>
                </div>

                <div className="flex flex-wrap items-center gap-1.5 px-4 py-2 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/60">
                    <span className="text-[11px] font-medium text-gray-500 dark:text-gray-400 mr-1">Role</span>
                    {HELP_ROLE_OPTIONS.map((option) => {
                        const selected = viewRole === option.id;
                        return (
                            <button
                                key={option.id}
                                type="button"
                                onClick={() => {
                                    setViewRole(option.id);
                                    setActiveId('intro');
                                }}
                                className={`px-2 py-1 rounded-md text-xs font-medium border ${
                                    selected
                                        ? ROLE_TAB_CLASSES[option.id]
                                        : 'text-gray-600 bg-white border-gray-200 hover:bg-gray-100 dark:text-gray-300 dark:bg-gray-900 dark:border-gray-600 dark:hover:bg-gray-800'
                                }`}
                                aria-pressed={selected}
                            >
                                {option.label}
                                {option.id === accountRole ? (
                                    <span className="ml-1 opacity-70">· you</span>
                                ) : null}
                            </button>
                        );
                    })}
                </div>

                <div className="flex flex-1 min-h-0">
                    <aside className="w-56 sm:w-64 shrink-0 border-r border-gray-200 dark:border-gray-700 flex flex-col min-h-0">
                        <div className="p-2 border-b border-gray-200 dark:border-gray-700">
                            <label className="relative block">
                                <FaSearch className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400" />
                                <input
                                    type="search"
                                    value={query}
                                    onChange={(event) => setQuery(event.target.value)}
                                    placeholder="Search controls…"
                                    className="w-full pl-7 pr-2 py-1.5 text-sm rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                                    aria-label="Search the user manual"
                                />
                            </label>
                        </div>
                        <nav className="flex-1 overflow-y-auto modal-scroll-panel p-2 space-y-3" data-modal-scroll>
                            {grouped.length === 0 && (
                                <p className="text-xs text-gray-500 px-2">No matching topics.</p>
                            )}
                            {grouped.map((group) => (
                                <div key={group.id}>
                                    <p className="px-2 mb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400">
                                        {group.title}
                                    </p>
                                    {group.sections.map((section) => (
                                        <button
                                            key={section.id}
                                            type="button"
                                            onClick={() => setActiveId(section.id)}
                                            className={`w-full text-left px-2 py-1.5 rounded-md text-sm ${
                                                active?.id === section.id
                                                    ? 'bg-blue-50 text-blue-800 dark:bg-blue-950/50 dark:text-blue-100'
                                                    : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
                                            }`}
                                        >
                                            {section.title}
                                        </button>
                                    ))}
                                </div>
                            ))}
                        </nav>
                    </aside>

                    <article className="flex-1 min-w-0 overflow-y-auto modal-scroll-panel px-4 py-4 space-y-3" data-modal-scroll>
                        {active ? (
                            <>
                                <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{active.title}</h3>
                                {active.blocks.map((block, index) => (
                                    <Block key={`${active.id}-${index}`} block={block} />
                                ))}
                            </>
                        ) : (
                            <p className="text-sm text-gray-500">Try a different search.</p>
                        )}
                    </article>
                </div>
            </div>
        </ModalOverlay>
    );
};

export default UserManualModal;
