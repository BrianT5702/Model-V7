import React, { useEffect, useMemo, useState } from 'react';
import { FaSearch, FaTimes } from 'react-icons/fa';
import ModalOverlay from '../../components/ModalOverlay';
import { useAuth } from '../auth/AuthContext';
import { ROLE_LABELS } from '../auth/authUtils';
import {
    MANUAL_GROUPS,
    searchManualSections,
} from './userManualContent';

/** Renders Help copy. Wrap UI labels in **bold**. */
const HelpText = ({ text }) => {
    if (text == null || text === '') return null;
    const parts = String(text).split(/(\*\*[^*]+\*\*)/g);
    return (
        <>
            {parts.map((part, index) => {
                if (part.startsWith('**') && part.endsWith('**')) {
                    return (
                        <strong key={index} className="font-semibold text-gray-900 dark:text-gray-50">
                            {part.slice(2, -2)}
                        </strong>
                    );
                }
                return <React.Fragment key={index}>{part}</React.Fragment>;
            })}
        </>
    );
};

const Block = ({ block }) => {
    if (block.type === 'img') {
        return (
            <figure className="my-1">
                <img
                    src={block.src}
                    alt={block.alt || ''}
                    className="w-full max-h-64 object-contain object-top bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700"
                />
                {block.caption ? (
                    <figcaption className="mt-2 text-sm text-gray-600 dark:text-gray-300 leading-snug">
                        <HelpText text={block.caption} />
                    </figcaption>
                ) : null}
            </figure>
        );
    }
    if (block.type === 'p') {
        return (
            <p className="text-[15px] text-gray-800 dark:text-gray-200 leading-[1.65]">
                <HelpText text={block.text} />
            </p>
        );
    }
    if (block.type === 'h3') {
        return (
            <h3 className="mt-6 mb-2.5 pl-3 text-xl font-bold tracking-tight text-blue-700 dark:text-sky-400 border-l-[3px] border-blue-600 dark:border-sky-400 leading-snug">
                {block.text}
            </h3>
        );
    }
    if (block.type === 'note') {
        return (
            <p className="text-[15px] leading-[1.65] text-amber-950 dark:text-amber-100 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-lg px-3.5 py-2.5">
                <HelpText text={block.text} />
            </p>
        );
    }
    if (block.type === 'ul') {
        return (
            <ul className="list-disc pl-5 space-y-2 text-[15px] text-gray-800 dark:text-gray-200 leading-[1.65]">
                {block.items.map((item, index) => (
                    <li key={index} className="pl-1">
                        <HelpText text={item} />
                    </li>
                ))}
            </ul>
        );
    }
    if (block.type === 'steps') {
        return (
            <ol className="list-decimal pl-5 space-y-2.5 text-[15px] text-gray-800 dark:text-gray-200 leading-[1.65] marker:font-semibold marker:text-gray-500 dark:marker:text-gray-400">
                {block.items.map((item, index) => (
                    <li key={index} className="pl-1.5">
                        <HelpText text={item} />
                    </li>
                ))}
            </ol>
        );
    }
    if (block.type === 'table') {
        return (
            <div className="overflow-x-auto border border-gray-200 dark:border-gray-700 rounded-lg">
                <table className="w-full text-[14px] text-left">
                    <thead className="bg-gray-50 dark:bg-gray-800 text-gray-600 dark:text-gray-300">
                        <tr>
                            {block.headers.map((header) => (
                                <th key={header} className="px-3 py-2.5 font-semibold">
                                    <HelpText text={header} />
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
                                        className={`px-3 py-2.5 leading-[1.6] ${
                                            index === 0
                                                ? 'font-medium text-gray-900 dark:text-gray-100 min-w-[8rem]'
                                                : 'text-gray-800 dark:text-gray-200'
                                        }`}
                                    >
                                        <HelpText text={cell} />
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
    const [query, setQuery] = useState('');
    const [activeId, setActiveId] = useState('intro');

    useEffect(() => {
        setActiveId('intro');
    }, [accountRole]);

    const matches = useMemo(() => searchManualSections(query, accountRole), [query, accountRole]);
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
                        <p className="text-sm text-gray-600 dark:text-gray-300 mt-0.5">
                            {accountRole === 'guest'
                                ? 'Sign in to see Help for your account. This page only covers signing in.'
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
                        <nav className="flex-1 overflow-y-auto modal-scroll-panel p-2 space-y-4" data-modal-scroll>
                            {grouped.length === 0 && (
                                <p className="text-sm text-gray-500 px-2">No matching topics.</p>
                            )}
                            {grouped.map((group) => (
                                <div key={group.id}>
                                    <p className="px-2 mb-1.5 text-[11px] font-bold uppercase tracking-wider text-blue-700 dark:text-blue-300">
                                        {group.title}
                                    </p>
                                    {group.sections.map((section) => (
                                        <button
                                            key={section.id}
                                            type="button"
                                            onClick={() => setActiveId(section.id)}
                                            className={`w-full text-left px-2 py-1.5 rounded-md text-sm leading-snug ${
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

                    <article className="flex-1 min-w-0 overflow-y-auto modal-scroll-panel px-5 sm:px-8 py-5" data-modal-scroll>
                        {active ? (
                            <div className="max-w-[40rem] space-y-3">
                                <h3 className="text-2xl font-bold text-gray-900 dark:text-white tracking-tight pb-2 mb-1 border-b-2 border-blue-500 dark:border-blue-400">
                                    {active.title}
                                </h3>
                                {active.blocks.map((block, index) => (
                                    <Block key={`${active.id}-${index}`} block={block} />
                                ))}
                            </div>
                        ) : (
                            <p className="text-[15px] text-gray-500">Try a different search.</p>
                        )}
                    </article>
                </div>
            </div>
        </ModalOverlay>
    );
};

export default UserManualModal;
