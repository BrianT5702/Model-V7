import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
    FaChevronDown,
    FaChevronRight,
    FaCube,
    FaEllipsisV,
    FaFolder,
    FaFolderOpen,
    FaFolderPlus,
    FaPencilAlt,
    FaPlus,
    FaSearch,
    FaTimes,
    FaTrash,
} from 'react-icons/fa';
import { UNCATEGORIZED_KEY } from './ProjectFolderSection';
import {
    buildFolderTree,
    flattenVisibleFolderTree,
    getChildFolders,
    getDefaultExpandedFolderIds,
    getFolderBreadcrumbSegments,
    getFolderPath,
} from './projectFolderUtils';

const BreadcrumbSeparator = () => (
    <FaChevronRight className="w-3 h-3 mx-1.5 text-gray-400 shrink-0" aria-hidden="true" />
);

const BreadcrumbItem = ({ label, onClick, isCurrent = false }) => {
    if (isCurrent || !onClick) {
        return (
            <span className="truncate text-gray-900 font-medium" aria-current={isCurrent ? 'page' : undefined}>
                {label}
            </span>
        );
    }

    return (
        <button
            type="button"
            onClick={onClick}
            className="truncate text-gray-700 hover:text-blue-600 hover:underline"
        >
            {label}
        </button>
    );
};

const formatDate = (value) => {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
    });
};

const formatDimensions = (project) => {
    const height = project.calculated_height ?? project.height;
    return `${project.width} × ${project.length} × ${height} mm`;
};

const FolderTreeItem = ({
    folderKey,
    label,
    count,
    depth = 0,
    hasChildren = false,
    isExpanded = false,
    onToggleExpand,
    searchMatchCount = 0,
    isSearching = false,
    isSelected,
    isDropTarget,
    showActions,
    onSelect,
    onDragOver,
    onDragLeave,
    onDrop,
    onRename,
    onDelete,
    onStartCreateSubfolder,
}) => {
    const [menuOpen, setMenuOpen] = useState(false);
    const isUncategorized = folderKey === UNCATEGORIZED_KEY;
    const hasSearchMatch = isSearching && searchMatchCount > 0;
    const isSearchDimmed = isSearching && searchMatchCount === 0;

    return (
        <div
            className={`group relative flex items-center gap-1 rounded-md mx-1 transition-opacity ${
                isDropTarget ? 'bg-blue-100 ring-1 ring-blue-300' : ''
            } ${isSearchDimmed ? 'opacity-35' : ''}`}
            style={{ paddingLeft: `${depth * 14}px` }}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
        >
            {hasChildren ? (
                <button
                    type="button"
                    onClick={(e) => {
                        e.stopPropagation();
                        onToggleExpand?.();
                    }}
                    className="p-1 text-gray-400 hover:text-gray-700 rounded shrink-0"
                    aria-label={isExpanded ? 'Collapse folder' : 'Expand folder'}
                >
                    {isExpanded ? <FaChevronDown className="w-3 h-3" /> : <FaChevronRight className="w-3 h-3" />}
                </button>
            ) : (
                <span className="w-5 shrink-0" />
            )}
            <button
                type="button"
                onClick={onSelect}
                className={`flex flex-1 items-center gap-2 min-w-0 px-2 py-1.5 text-left text-sm rounded-md transition-colors ${
                    isSelected
                        ? 'bg-blue-600 text-white'
                        : hasSearchMatch
                            ? 'bg-amber-100 text-amber-950 ring-1 ring-amber-300 hover:bg-amber-200 font-medium'
                            : 'text-gray-700 hover:bg-gray-100'
                }`}
            >
                {isSelected ? (
                    <FaFolderOpen className={`w-4 h-4 shrink-0 ${isSelected ? 'text-blue-100' : 'text-amber-500'}`} />
                ) : (
                    <FaFolder className={`w-4 h-4 shrink-0 ${
                        isSelected ? 'text-blue-100' : hasSearchMatch ? 'text-amber-600' : 'text-amber-500'
                    }`} />
                )}
                <span className="truncate flex-1">{label}</span>
                {isSearching ? (
                    hasSearchMatch ? (
                        <span className="text-[10px] font-semibold shrink-0 px-1.5 py-0.5 rounded-full bg-amber-200 text-amber-900">
                            {searchMatchCount}
                        </span>
                    ) : null
                ) : (
                    <span className={`text-xs shrink-0 ${isSelected ? 'text-blue-100' : 'text-gray-400'}`}>
                        {count}
                    </span>
                )}
            </button>

            {showActions && !isUncategorized && (
                <div className="relative shrink-0 pr-1">
                    <button
                        type="button"
                        onClick={(e) => {
                            e.stopPropagation();
                            setMenuOpen((open) => !open);
                        }}
                        className={`p-1 rounded opacity-0 group-hover:opacity-100 transition-opacity ${
                            isSelected ? 'text-blue-100 hover:bg-blue-500' : 'text-gray-500 hover:bg-gray-200'
                        }`}
                        aria-label="Folder actions"
                    >
                        <FaEllipsisV className="w-3 h-3" />
                    </button>
                    {menuOpen && (
                        <>
                            <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
                            <div className="absolute right-0 top-full mt-1 z-20 w-40 bg-white border border-gray-200 rounded-lg shadow-lg py-1 text-sm">
                                {onStartCreateSubfolder && (
                                    <button
                                        type="button"
                                        className="w-full px-3 py-1.5 text-left hover:bg-gray-50 flex items-center gap-2"
                                        onClick={() => {
                                            setMenuOpen(false);
                                            onStartCreateSubfolder(folderKey);
                                        }}
                                    >
                                        <FaFolderPlus className="w-3 h-3 text-amber-600" />
                                        New subfolder
                                    </button>
                                )}
                                <button
                                    type="button"
                                    className="w-full px-3 py-1.5 text-left hover:bg-gray-50 flex items-center gap-2"
                                    onClick={() => {
                                        setMenuOpen(false);
                                        onRename?.(folderKey);
                                    }}
                                >
                                    <FaPencilAlt className="w-3 h-3 text-gray-500" />
                                    Rename
                                </button>
                                <button
                                    type="button"
                                    className="w-full px-3 py-1.5 text-left hover:bg-red-50 text-red-600 flex items-center gap-2"
                                    onClick={() => {
                                        setMenuOpen(false);
                                        onDelete?.(folderKey);
                                    }}
                                >
                                    <FaTrash className="w-3 h-3" />
                                    Delete
                                </button>
                            </div>
                        </>
                    )}
                </div>
            )}
        </div>
    );
};

const matchesProjectSearch = (project, folderLabel, query) => {
    if (!query) return true;
    const parts = [
        project.name,
        folderLabel,
        project.folder_name,
        project.width,
        project.length,
        project.calculated_height ?? project.height,
        project.created_by_username,
        project.last_edited_by_username,
    ];
    const haystack = parts.filter((v) => v !== null && v !== undefined).join(' ').toLowerCase();
    return haystack.includes(query);
};

const SubfolderRow = ({
    folder,
    projectCount,
    subfolderCount,
    onOpen,
}) => (
    <tr
        className="border-t border-gray-100 hover:bg-amber-50/40 cursor-pointer group"
        onDoubleClick={() => onOpen(folder.id)}
    >
        <td className="px-4 py-3">
            <button
                type="button"
                onClick={() => onOpen(folder.id)}
                className="flex items-center gap-2 min-w-0 text-left font-medium text-gray-900 hover:text-amber-800"
            >
                <FaFolder className="w-4 h-4 shrink-0 text-amber-500" />
                <span className="truncate">{folder.name}</span>
            </button>
        </td>
        <td className="px-4 py-3 hidden md:table-cell text-gray-500 text-sm">Folder</td>
        <td className="px-4 py-3 hidden md:table-cell text-gray-500 text-sm">—</td>
        <td className="px-4 py-3 hidden md:table-cell text-gray-500 text-sm">—</td>
        <td className="px-4 py-3 hidden sm:table-cell text-gray-500 text-sm">—</td>
        <td className="px-4 py-3">
            <div className="flex items-center justify-end gap-2">
                <span className="text-xs text-gray-400">
                    {subfolderCount > 0 && `${subfolderCount} folder${subfolderCount !== 1 ? 's' : ''}`}
                    {subfolderCount > 0 && projectCount > 0 && ', '}
                    {projectCount > 0 && `${projectCount} project${projectCount !== 1 ? 's' : ''}`}
                    {subfolderCount === 0 && projectCount === 0 && 'Empty'}
                </span>
                <button
                    type="button"
                    onClick={() => onOpen(folder.id)}
                    className="text-xs text-blue-600 font-medium opacity-0 group-hover:opacity-100"
                >
                    Open
                </button>
            </div>
        </td>
    </tr>
);

const ProjectRow = ({
    project,
    folderLabel,
    showFolderColumn,
    onGoToFolder,
    isDragging,
    canEdit,
    enableDrag,
    onDragStart,
    onDragEnd,
    onOpen,
    onEdit,
    onDelete,
}) => (
    <tr
        draggable={enableDrag}
        onDragStart={enableDrag ? (e) => onDragStart(e, project) : undefined}
        onDragEnd={enableDrag ? onDragEnd : undefined}
        onDoubleClick={() => onOpen(project.id)}
        className={`group border-b border-gray-100 last:border-0 transition-colors ${
            isDragging ? 'opacity-50 bg-blue-50' : 'hover:bg-gray-50'
        } ${enableDrag ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'}`}
    >
        <td className="px-4 py-2.5">
            <button
                type="button"
                onClick={() => onOpen(project.id)}
                className="flex items-center gap-2.5 min-w-0 text-left w-full"
            >
                <span className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shrink-0">
                    <FaCube className="w-3.5 h-3.5 text-white" />
                </span>
                <span className="font-medium text-gray-900 truncate group-hover:text-blue-600">
                    {project.name}
                </span>
            </button>
        </td>
        {showFolderColumn && (
            <td className="px-4 py-2.5 text-sm whitespace-nowrap">
                {onGoToFolder ? (
                    <button
                        type="button"
                        onClick={(e) => {
                            e.stopPropagation();
                            onGoToFolder(project.folder ?? null);
                        }}
                        className="inline-flex items-center gap-1.5 text-amber-700 hover:text-amber-900 hover:underline max-w-[140px]"
                        title="Go to folder"
                    >
                        <FaFolder className="w-3 h-3 shrink-0" />
                        <span className="truncate">{folderLabel}</span>
                    </button>
                ) : (
                    <span className="text-gray-600">{folderLabel}</span>
                )}
            </td>
        )}
        <td className="px-4 py-2.5 text-sm text-gray-600 hidden md:table-cell whitespace-nowrap">
            {formatDimensions(project)}
        </td>
        <td className="px-4 py-2.5 text-sm text-gray-600 hidden md:table-cell whitespace-nowrap">
            {project.created_by_username || '—'}
        </td>
        <td className="px-4 py-2.5 text-sm text-gray-600 hidden md:table-cell whitespace-nowrap">
            {project.last_edited_by_username || '—'}
        </td>
        <td className="px-4 py-2.5 text-sm text-gray-500 hidden sm:table-cell whitespace-nowrap">
            {formatDate(project.updated_at)}
        </td>
        <td className="px-4 py-2.5 text-right">
            {canEdit ? (
                <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                        type="button"
                        onClick={(e) => {
                            e.stopPropagation();
                            onEdit(project);
                        }}
                        className="p-1.5 text-blue-600 hover:bg-blue-50 rounded"
                        title="Edit project"
                    >
                        <FaPencilAlt className="w-3.5 h-3.5" />
                    </button>
                    <button
                        type="button"
                        onClick={(e) => {
                            e.stopPropagation();
                            onDelete(project.id);
                        }}
                        className="p-1.5 text-red-600 hover:bg-red-50 rounded"
                        title="Delete project"
                    >
                        <FaTrash className="w-3.5 h-3.5" />
                    </button>
                </div>
            ) : (
                <button
                    type="button"
                    onClick={() => onOpen(project.id)}
                    className="text-xs text-blue-600 font-medium opacity-0 group-hover:opacity-100"
                >
                    Open
                </button>
            )}
        </td>
    </tr>
);

const ProjectExplorer = ({
    folders,
    projectsByFolder,
    selectedFolderKey,
    onSelectFolder,
    dropTargetId,
    showSidebar = true,
    showFolderToolbar = true,
    canEdit,
    draggingProjectId,
    onStartCreateFolder,
    onRenameFolderRequest,
    onDeleteFolder,
    onDragOverFolder,
    onDragLeaveFolder,
    onDropOnFolder,
    onProjectDragStart,
    onProjectDragEnd,
    onProjectClick,
    onProjectEdit,
    onProjectDelete,
    onCreateInFolder,
    currentFolderLabel,
    createFolderParentLabel,
    onStartCreateSubfolder,
}) => {
    const [searchQuery, setSearchQuery] = useState('');
    const [expandedFolderIds, setExpandedFolderIds] = useState(() => new Set());
    const searchInputRef = useRef(null);
    const normalizedSearch = searchQuery.trim().toLowerCase();
    const isSearching = normalizedSearch.length > 0;

    const folderTree = useMemo(() => buildFolderTree(folders), [folders]);

    const allFolderIds = useMemo(() => new Set(folders.map((f) => f.id)), [folders]);

    useEffect(() => {
        setExpandedFolderIds(getDefaultExpandedFolderIds(folders, selectedFolderKey));
    }, [folders, selectedFolderKey]);

    const visibleFolderRows = useMemo(() => {
        const expanded = isSearching ? allFolderIds : expandedFolderIds;
        return flattenVisibleFolderTree(folderTree, expanded);
    }, [folderTree, expandedFolderIds, allFolderIds, isSearching]);

    const folderLabelByKey = useMemo(() => {
        const map = { [UNCATEGORIZED_KEY]: 'Uncategorized' };
        folders.forEach((folder) => {
            map[folder.id] = getFolderPath(folder.id, folders);
        });
        return map;
    }, [folders]);

    const getFolderLabel = (folderKey) => folderLabelByKey[folderKey ?? UNCATEGORIZED_KEY] ?? 'Uncategorized';

    const toggleFolderExpanded = (folderId) => {
        setExpandedFolderIds((prev) => {
            const next = new Set(prev);
            if (next.has(folderId)) {
                next.delete(folderId);
            } else {
                next.add(folderId);
            }
            return next;
        });
    };

    const allProjects = useMemo(() => {
        const seen = new Set();
        const list = [];
        Object.values(projectsByFolder).forEach((projects) => {
            projects.forEach((project) => {
                if (seen.has(project.id)) return;
                seen.add(project.id);
                const folderKey = project.folder ?? UNCATEGORIZED_KEY;
                list.push({
                    ...project,
                    _folderKey: folderKey,
                    _folderLabel: folderLabelByKey[folderKey] ?? 'Uncategorized',
                });
            });
        });
        return list.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
    }, [projectsByFolder, folderLabelByKey]);

    const searchResults = useMemo(() => {
        if (!isSearching) return [];
        return allProjects.filter((project) =>
            matchesProjectSearch(project, project._folderLabel, normalizedSearch)
        );
    }, [allProjects, isSearching, normalizedSearch]);

    const searchMatchCountByFolder = useMemo(() => {
        const counts = { [UNCATEGORIZED_KEY]: 0 };
        folders.forEach((folder) => {
            counts[folder.id] = 0;
        });
        searchResults.forEach((project) => {
            const key = project._folderKey ?? UNCATEGORIZED_KEY;
            counts[key] = (counts[key] ?? 0) + 1;
        });
        return counts;
    }, [searchResults, folders]);

    const sortedVisibleFolderRows = useMemo(() => {
        if (!isSearching) return visibleFolderRows;
        return [...visibleFolderRows].sort((a, b) => {
            const matchA = searchMatchCountByFolder[a.key] ?? 0;
            const matchB = searchMatchCountByFolder[b.key] ?? 0;
            if (matchB !== matchA) return matchB - matchA;
            return a.folder.name.localeCompare(b.folder.name);
        });
    }, [visibleFolderRows, isSearching, searchMatchCountByFolder]);

    const breadcrumbSegments = useMemo(() => {
        if (!showSidebar || isSearching) return [];
        return getFolderBreadcrumbSegments(selectedFolderKey, folders);
    }, [showSidebar, isSearching, selectedFolderKey, folders]);

    const folderProjects = projectsByFolder[selectedFolderKey] || [];
    const displayedProjects = isSearching ? searchResults : folderProjects;
    const childFolders = useMemo(() => {
        if (isSearching || !showSidebar) return [];
        return getChildFolders(selectedFolderKey, folders);
    }, [isSearching, showSidebar, selectedFolderKey, folders]);

    const subfolderCountById = useMemo(() => {
        const counts = {};
        folders.forEach((folder) => {
            if (folder.parent != null) {
                counts[folder.parent] = (counts[folder.parent] ?? 0) + 1;
            }
        });
        return counts;
    }, [folders]);

    const displayedCount = isSearching
        ? displayedProjects.length
        : childFolders.length + displayedProjects.length;

    const handleSelectFolder = (folderKey) => {
        setSearchQuery('');
        onSelectFolder(folderKey);
    };

    const handleGoToFolderFromSearch = (folderId) => {
        const folderKey = folderId ?? UNCATEGORIZED_KEY;
        setSearchQuery('');
        onSelectFolder(folderKey);
    };

    const handleSearchKeyDown = (e) => {
        if (e.key === 'Escape') {
            setSearchQuery('');
            searchInputRef.current?.blur();
        }
    };

    return (
        <div className="flex flex-col h-full min-h-[420px] bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            {/* Toolbar */}
            <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-gray-200 bg-gray-50/80">
                <nav className="flex items-center flex-wrap text-sm text-gray-600 min-w-0 sm:flex-1" aria-label="Folder breadcrumb">
                    <BreadcrumbItem
                        label="Projects"
                        onClick={() => handleSelectFolder(UNCATEGORIZED_KEY)}
                    />
                    {!isSearching && showSidebar && breadcrumbSegments.map((segment, index) => {
                        const isLast = index === breadcrumbSegments.length - 1;
                        return (
                            <React.Fragment key={segment.key}>
                                <BreadcrumbSeparator />
                                <BreadcrumbItem
                                    label={segment.label}
                                    onClick={isLast ? null : () => handleSelectFolder(segment.key)}
                                    isCurrent={isLast}
                                />
                            </React.Fragment>
                        );
                    })}
                    {!isSearching && !showSidebar && (
                        <>
                            <BreadcrumbSeparator />
                            <BreadcrumbItem label="All projects" isCurrent />
                        </>
                    )}
                    {isSearching && (
                        <>
                            <BreadcrumbSeparator />
                            <BreadcrumbItem label="Search results" isCurrent />
                            <BreadcrumbSeparator />
                            <span className="truncate text-gray-500 italic">&ldquo;{searchQuery.trim()}&rdquo;</span>
                        </>
                    )}
                    <span className="ml-2 text-gray-400 shrink-0">({displayedCount})</span>
                </nav>

                <div className="relative w-full sm:w-auto sm:min-w-[220px] sm:max-w-xs order-first sm:order-none">
                    <FaSearch className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
                    <input
                        ref={searchInputRef}
                        type="search"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        onKeyDown={handleSearchKeyDown}
                        placeholder="Search projects..."
                        className="w-full pl-8 pr-8 py-1.5 text-sm border border-gray-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-blue-400"
                        aria-label="Search projects"
                    />
                    {searchQuery && (
                        <button
                            type="button"
                            onClick={() => setSearchQuery('')}
                            className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-gray-400 hover:text-gray-600 rounded"
                            aria-label="Clear search"
                        >
                            <FaTimes className="w-3.5 h-3.5" />
                        </button>
                    )}
                </div>

                {canEdit && !isSearching && onCreateInFolder && (
                    <button
                        type="button"
                        onClick={onCreateInFolder}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 shrink-0"
                        title={`Create project in ${currentFolderLabel}`}
                    >
                        <FaPlus className="w-3.5 h-3.5" />
                        <span className="hidden md:inline">New project here</span>
                        <span className="md:hidden">New</span>
                    </button>
                )}

                {canEdit && showFolderToolbar && (
                    <button
                        type="button"
                        onClick={onStartCreateFolder}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 shrink-0"
                        title={createFolderParentLabel === 'top level'
                            ? 'Create folder at top level'
                            : `Create subfolder in ${createFolderParentLabel}`}
                    >
                        <FaFolderPlus className="w-3.5 h-3.5 text-amber-600" />
                        {createFolderParentLabel === 'top level' ? 'New folder' : 'New subfolder'}
                    </button>
                )}
            </div>

            <div className="flex flex-1 min-h-0 flex-col sm:flex-row">
                {showSidebar && (
                <aside className="sm:w-56 lg:w-64 shrink-0 border-b sm:border-b-0 sm:border-r border-gray-200 bg-gray-50/50 overflow-y-auto">
                    <div className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                        Folders
                    </div>
                    {isSearching && (
                        <p className="px-3 pb-2 text-[11px] text-amber-800 leading-snug">
                            Highlighted folders contain matches. Click a folder to open it.
                        </p>
                    )}
                    <div className="pb-2 space-y-0.5">
                        <FolderTreeItem
                            folderKey={UNCATEGORIZED_KEY}
                            label="Uncategorized"
                            count={(projectsByFolder[UNCATEGORIZED_KEY] || []).length}
                            depth={0}
                            searchMatchCount={searchMatchCountByFolder[UNCATEGORIZED_KEY] ?? 0}
                            isSearching={isSearching}
                            isSelected={!isSearching && selectedFolderKey === UNCATEGORIZED_KEY}
                            isDropTarget={canEdit && !isSearching && dropTargetId === UNCATEGORIZED_KEY}
                            showActions={false}
                            onSelect={() => handleSelectFolder(UNCATEGORIZED_KEY)}
                            onDragOver={canEdit ? (e) => onDragOverFolder(e, UNCATEGORIZED_KEY) : undefined}
                            onDragLeave={canEdit ? onDragLeaveFolder : undefined}
                            onDrop={canEdit ? (e) => onDropOnFolder(e, UNCATEGORIZED_KEY) : undefined}
                        />
                        {sortedVisibleFolderRows.map((row) => (
                            <FolderTreeItem
                                key={row.key}
                                folderKey={row.key}
                                label={row.folder.name}
                                count={(projectsByFolder[row.key] || []).length}
                                depth={row.depth}
                                hasChildren={row.hasChildren}
                                isExpanded={isSearching || expandedFolderIds.has(row.key)}
                                onToggleExpand={() => toggleFolderExpanded(row.key)}
                                searchMatchCount={searchMatchCountByFolder[row.key] ?? 0}
                                isSearching={isSearching}
                                isSelected={!isSearching && selectedFolderKey === row.key}
                                isDropTarget={canEdit && !isSearching && dropTargetId === row.key}
                                showActions={canEdit}
                                onSelect={() => handleSelectFolder(row.key)}
                                onDragOver={canEdit ? (e) => onDragOverFolder(e, row.key) : undefined}
                                onDragLeave={canEdit ? onDragLeaveFolder : undefined}
                                onDrop={canEdit ? (e) => onDropOnFolder(e, row.key) : undefined}
                                onRename={onRenameFolderRequest}
                                onDelete={onDeleteFolder}
                                onStartCreateSubfolder={canEdit ? onStartCreateSubfolder : undefined}
                            />
                        ))}
                    </div>
                    {canEdit && (
                        <p className="px-3 py-2 text-[11px] text-gray-400 leading-snug">
                            Drag projects onto a folder to move them.
                        </p>
                    )}
                </aside>
                )}

                {/* Main content — file list */}
                <main className="flex-1 min-w-0 flex flex-col overflow-hidden">
                    <div className="overflow-auto flex-1">
                        {displayedCount === 0 ? (
                            <div className="flex flex-col items-center justify-center h-full min-h-[200px] text-gray-400 px-4">
                                {isSearching ? (
                                    <>
                                        <FaSearch className="w-12 h-12 mb-3 text-gray-300" />
                                        <p className="text-sm font-medium text-gray-500">No projects match your search</p>
                                        <p className="text-xs mt-1 text-gray-400">Try a different name, folder, or dimension</p>
                                        <button
                                            type="button"
                                            onClick={() => setSearchQuery('')}
                                            className="mt-3 text-sm text-blue-600 hover:underline"
                                        >
                                            Clear search
                                        </button>
                                    </>
                                ) : (
                                    <>
                                        <FaFolderOpen className="w-12 h-12 mb-3 text-gray-300" />
                                        <p className="text-sm font-medium text-gray-500">
                                            {selectedFolderKey === UNCATEGORIZED_KEY
                                                ? 'No projects here yet'
                                                : 'This folder is empty'}
                                        </p>
                                {canEdit && onCreateInFolder && (
                                    <button
                                        type="button"
                                        onClick={onCreateInFolder}
                                        className="mt-3 inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-blue-600 border border-blue-200 rounded-lg hover:bg-blue-50"
                                    >
                                        <FaPlus className="w-3.5 h-3.5" />
                                        New project in {currentFolderLabel}
                                    </button>
                                )}
                                    </>
                                )}
                            </div>
                        ) : (
                            <table className="w-full text-left">
                                <thead className="sticky top-0 bg-gray-50 border-b border-gray-200 text-xs font-semibold uppercase tracking-wide text-gray-500">
                                    <tr>
                                        <th className="px-4 py-2.5">Name</th>
                                        {isSearching && <th className="px-4 py-2.5">Folder</th>}
                                        <th className="px-4 py-2.5 hidden md:table-cell">Dimensions</th>
                                        <th className="px-4 py-2.5 hidden md:table-cell">Created by</th>
                                        <th className="px-4 py-2.5 hidden md:table-cell">Last edited by</th>
                                        <th className="px-4 py-2.5 hidden sm:table-cell">Modified</th>
                                        <th className="px-4 py-2.5 w-20" />
                                    </tr>
                                </thead>
                                <tbody>
                                    {!isSearching && childFolders.map((folder) => (
                                        <SubfolderRow
                                            key={`folder-${folder.id}`}
                                            folder={folder}
                                            projectCount={(projectsByFolder[folder.id] || []).length}
                                            subfolderCount={subfolderCountById[folder.id] ?? 0}
                                            onOpen={handleSelectFolder}
                                        />
                                    ))}
                                    {displayedProjects.map((project) => (
                                        <ProjectRow
                                            key={project.id}
                                            project={project}
                                            folderLabel={isSearching ? project._folderLabel : getFolderLabel(selectedFolderKey)}
                                            showFolderColumn={isSearching}
                                            onGoToFolder={isSearching ? handleGoToFolderFromSearch : undefined}
                                            isDragging={draggingProjectId === project.id}
                                            canEdit={canEdit && !isSearching}
                                            enableDrag={canEdit && !isSearching}
                                            onDragStart={onProjectDragStart}
                                            onDragEnd={onProjectDragEnd}
                                            onOpen={(projectId) => onProjectClick(
                                                projectId,
                                                isSearching ? project._folderKey : selectedFolderKey,
                                            )}
                                            onEdit={onProjectEdit}
                                            onDelete={onProjectDelete}
                                        />
                                    ))}
                                </tbody>
                            </table>
                        )}
                    </div>

                    <footer className="px-4 py-2 border-t border-gray-100 bg-gray-50/50 text-xs text-gray-500">
                        {isSearching
                            ? `${displayedCount} result${displayedCount !== 1 ? 's' : ''} across all folders`
                            : `${displayedCount} item${displayedCount !== 1 ? 's' : ''}`}
                        {!isSearching && canEdit && displayedCount > 0 && (
                            <span className="hidden sm:inline"> · Double-click a project to open</span>
                        )}
                    </footer>
                </main>
            </div>
        </div>
    );
};

export default ProjectExplorer;
