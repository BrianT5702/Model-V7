import { UNCATEGORIZED_KEY } from './ProjectFolderSection';

export { UNCATEGORIZED_KEY };

export const folderKeyToId = (folderKey) => (
    folderKey === UNCATEGORIZED_KEY ? null : folderKey
);

export const getCreateFolderParentId = (selectedFolderKey) => (
    selectedFolderKey === UNCATEGORIZED_KEY ? null : selectedFolderKey
);

export const getNextListOrder = (projects, folderKey) => {
    const targetFolderId = folderKeyToId(folderKey);
    const inFolder = projects.filter((p) => (p.folder ?? null) === targetFolderId);
    if (inFolder.length === 0) return 0;
    return Math.max(...inFolder.map((p) => p.list_order ?? 0)) + 1;
};

export const getFolderById = (folders, folderId) => (
    folders.find((f) => f.id === folderId) ?? null
);

export const getFolderPath = (folderKey, folders) => {
    if (folderKey === UNCATEGORIZED_KEY || folderKey == null) {
        return 'Uncategorized';
    }
    const map = new Map(folders.map((f) => [f.id, f]));
    const parts = [];
    let current = map.get(folderKey);
    while (current) {
        parts.unshift(current.name);
        current = current.parent ? map.get(current.parent) : null;
    }
    return parts.join(' / ') || 'Folder';
};

export const getFolderLabel = (folderKey, folders) => getFolderPath(folderKey, folders);

export const mergeProjectFolderMeta = (project, folderKey, folders) => {
    const targetFolderId = folderKeyToId(folderKey);
    return {
        ...project,
        folder: targetFolderId,
        folder_name: getFolderPath(folderKey, folders),
    };
};

export const buildFolderTree = (folders) => {
    const map = new Map();
    folders.forEach((folder) => {
        map.set(folder.id, { ...folder, children: [] });
    });

    const roots = [];
    folders.forEach((folder) => {
        const node = map.get(folder.id);
        if (!node) return;
        if (folder.parent) {
            const parentNode = map.get(folder.parent);
            if (parentNode) {
                parentNode.children.push(node);
            } else {
                roots.push(node);
            }
        } else {
            roots.push(node);
        }
    });

    const sortNodes = (nodes) => {
        nodes.sort((a, b) => {
            const orderA = a.order ?? 0;
            const orderB = b.order ?? 0;
            if (orderA !== orderB) return orderA - orderB;
            return a.name.localeCompare(b.name);
        });
        nodes.forEach((node) => sortNodes(node.children));
    };

    sortNodes(roots);
    return roots;
};

export const flattenVisibleFolderTree = (nodes, expandedIds, depth = 0) => {
    const rows = [];
    nodes.forEach((node) => {
        rows.push({
            key: node.id,
            folder: node,
            depth,
            hasChildren: node.children.length > 0,
        });
        if (node.children.length > 0 && expandedIds.has(node.id)) {
            rows.push(...flattenVisibleFolderTree(node.children, expandedIds, depth + 1));
        }
    });
    return rows;
};

export const getAncestorFolderIds = (folderKey, folders) => {
    if (folderKey === UNCATEGORIZED_KEY || folderKey == null) {
        return new Set();
    }
    const map = new Map(folders.map((f) => [f.id, f]));
    const ancestors = new Set();
    let current = map.get(folderKey);
    while (current?.parent) {
        ancestors.add(current.parent);
        current = map.get(current.parent);
    }
    return ancestors;
};

export const collectDescendantFolderIds = (folderKey, folders) => {
    if (folderKey === UNCATEGORIZED_KEY || folderKey == null) {
        return [];
    }
    const childrenByParent = new Map();
    folders.forEach((folder) => {
        const parentKey = folder.parent ?? null;
        if (!childrenByParent.has(parentKey)) {
            childrenByParent.set(parentKey, []);
        }
        childrenByParent.get(parentKey).push(folder.id);
    });

    const ids = [];
    const walk = (id) => {
        ids.push(id);
        (childrenByParent.get(id) || []).forEach(walk);
    };
    walk(folderKey);
    return ids;
};

export const getDefaultExpandedFolderIds = (folders, selectedFolderKey) => {
    const expanded = new Set(getAncestorFolderIds(selectedFolderKey, folders));
    folders.forEach((folder) => {
        if (!folder.parent) {
            expanded.add(folder.id);
        }
    });
    return expanded;
};
