import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useShare } from './ShareContext';

/**
 * Share recipients stay on the shared project:
 * - Always block project list / home / create / other projects
 * - View-only: also block login
 * - Editable: allow login (then return to the share link), but never registration
 */
const ShareSessionGuard = ({ children }) => {
    const { isShareSession, isEditShare, share } = useShare();
    const location = useLocation();

    if (!isShareSession || !share?.token) {
        return children;
    }

    const path = location.pathname;
    const sharePath = `/share/${share.token}`;

    if (path.startsWith('/share/')) {
        return children;
    }

    // Editable shares may use login; view-only may not.
    if (path === '/login' && isEditShare) {
        return children;
    }

    if (path === `/projects/${share.projectId}`) {
        return <Navigate to={sharePath} replace />;
    }

    if (
        path === '/'
        || path === '/login'
        || path === '/projects'
        || path === '/projects/create'
        || path.startsWith('/projects/')
    ) {
        return <Navigate to={sharePath} replace />;
    }

    return children;
};

export default ShareSessionGuard;
