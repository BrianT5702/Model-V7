export const ROLES = {
    ADMIN: 'admin',
    DRAFTER: 'drafter',
    SALESMAN: 'salesman',
};

export const ROLE_LABELS = {
    [ROLES.ADMIN]: 'Admin',
    [ROLES.DRAFTER]: 'Drafter',
    [ROLES.SALESMAN]: 'Salesman',
};

export const ROLE_BADGE_CLASSES = {
    [ROLES.ADMIN]: 'text-indigo-700 bg-indigo-50 border-indigo-200',
    [ROLES.DRAFTER]: 'text-blue-700 bg-blue-50 border-blue-200',
    [ROLES.SALESMAN]: 'text-amber-700 bg-amber-50 border-amber-200',
};

export const canEditFromUser = (user) => {
    if (!user) return false;
    if (typeof user.can_edit === 'boolean') return user.can_edit;
    const role = user.role;
    return role === ROLES.ADMIN || role === ROLES.DRAFTER;
};

export const isAdminFromUser = (user) => {
    if (!user) return false;
    if (typeof user.is_admin === 'boolean') return user.is_admin;
    return user.role === ROLES.ADMIN;
};

export const canCommentFromUser = (user) => {
    if (!user) return false;
    return user.role === ROLES.SALESMAN;
};
