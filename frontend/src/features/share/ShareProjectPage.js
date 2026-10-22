import React, { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useShare } from './ShareContext';
import ProjectDetails from '../project/ProjectDetails';
import ShareFolderPage from './ShareFolderPage';

const ShareProjectPage = () => {
    const { shareToken } = useParams();
    const navigate = useNavigate();
    const {
        share,
        isResolving,
        resolveError,
        resolveShareToken,
    } = useShare();

    useEffect(() => {
        if (!shareToken) {
            return undefined;
        }
        if (share?.token === shareToken && (share.kind === 'folder' ? share.folderId : share.projectId)) {
            return undefined;
        }
        let cancelled = false;
        (async () => {
            const resolved = await resolveShareToken(shareToken);
            if (cancelled) return;
            if (!resolved) {
                // Stay on page to show error
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [shareToken, share?.token, share?.kind, share?.folderId, share?.projectId, resolveShareToken]);

    if (isResolving || (shareToken && !share && !resolveError)) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950 px-4">
                <p className="text-sm text-gray-600 dark:text-gray-300">Opening shared link…</p>
            </div>
        );
    }

    if (resolveError || (share?.kind !== 'folder' && !share?.projectId) || (share?.kind === 'folder' && !share?.folderId)) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950 px-4">
                <div className="max-w-md w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-6 shadow-sm">
                    <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">
                        Share link unavailable
                    </h1>
                    <p className="text-sm text-gray-600 dark:text-gray-300 mb-4">
                        {resolveError || 'This share link could not be opened.'}
                    </p>
                    <button
                        type="button"
                        onClick={() => navigate('/login', { replace: true })}
                        className="px-3 py-2 text-sm font-medium rounded-md bg-blue-600 text-white hover:bg-blue-700"
                    >
                        Go to login
                    </button>
                </div>
            </div>
        );
    }

    if (share.kind === 'folder') {
        return <ShareFolderPage />;
    }

    return <ProjectDetails shareProjectId={String(share.projectId)} />;
};

export default ShareProjectPage;
