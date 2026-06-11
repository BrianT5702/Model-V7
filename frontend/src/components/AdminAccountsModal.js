import React, { useCallback, useEffect, useState } from 'react';
import { FaPencilAlt, FaTimes, FaTrash, FaUserPlus, FaUsers } from 'react-icons/fa';
import ModalOverlay from './ModalOverlay';
import { useAuth } from '../features/auth/AuthContext';
import { ROLE_BADGE_CLASSES, ROLE_LABELS, ROLES } from '../features/auth/authUtils';

const ROLE_OPTIONS = [
    { value: ROLES.DRAFTER, label: ROLE_LABELS[ROLES.DRAFTER] },
    { value: ROLES.SALESMAN, label: ROLE_LABELS[ROLES.SALESMAN] },
];

const formatDate = (value) => {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
};

const AdminAccountsModal = ({ onClose }) => {
    const { registerUser, listUsers, updateUser, deleteUser } = useAuth();
    const [activeTab, setActiveTab] = useState('accounts');
    const [users, setUsers] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [feedback, setFeedback] = useState({ type: '', message: '' });

    const [createForm, setCreateForm] = useState({ username: '', password: '', role: ROLES.DRAFTER });
    const [isCreating, setIsCreating] = useState(false);

    const [editingId, setEditingId] = useState(null);
    const [editForm, setEditForm] = useState({ role: ROLES.DRAFTER, password: '' });
    const [isSaving, setIsSaving] = useState(false);
    const [deletingId, setDeletingId] = useState(null);

    const loadUsers = useCallback(async () => {
        setIsLoading(true);
        const result = await listUsers();
        setIsLoading(false);
        if (result.success) {
            setUsers(result.users);
        } else {
            setFeedback({ type: 'error', message: result.error });
        }
    }, [listUsers]);

    useEffect(() => {
        loadUsers();
    }, [loadUsers]);

    const handleCreate = async (event) => {
        event.preventDefault();
        setFeedback({ type: '', message: '' });
        setIsCreating(true);

        const result = await registerUser(
            createForm.username.trim(),
            createForm.password,
            createForm.role,
        );

        setIsCreating(false);

        if (result.success) {
            setFeedback({ type: 'success', message: result.message });
            setCreateForm({ username: '', password: '', role: ROLES.DRAFTER });
            await loadUsers();
            setActiveTab('accounts');
        } else {
            setFeedback({ type: 'error', message: result.error });
        }
    };

    const startEdit = (account) => {
        setEditingId(account.id);
        setEditForm({ role: account.role, password: '' });
        setFeedback({ type: '', message: '' });
    };

    const cancelEdit = () => {
        setEditingId(null);
        setEditForm({ role: ROLES.DRAFTER, password: '' });
    };

    const handleSaveEdit = async (account) => {
        setFeedback({ type: '', message: '' });
        setIsSaving(true);

        const payload = { role: editForm.role };
        if (editForm.password.trim()) {
            payload.password = editForm.password;
        }

        const result = await updateUser(account.id, payload);

        setIsSaving(false);

        if (result.success) {
            setFeedback({ type: 'success', message: result.message });
            cancelEdit();
            await loadUsers();
        } else {
            setFeedback({ type: 'error', message: result.error });
        }
    };

    const handleDelete = async (account) => {
        if (account.is_self) return;

        const confirmed = window.confirm(
            `Remove account "${account.username}"? This cannot be undone.`,
        );
        if (!confirmed) return;

        setFeedback({ type: '', message: '' });
        setDeletingId(account.id);

        const result = await deleteUser(account.id);

        setDeletingId(null);

        if (result.success) {
            setFeedback({ type: 'success', message: result.message });
            if (editingId === account.id) cancelEdit();
            await loadUsers();
        } else {
            setFeedback({ type: 'error', message: result.error });
        }
    };

    return (
        <ModalOverlay
            className="bg-black/50 flex items-center justify-center z-[60] p-4"
            onClick={onClose}
        >
            <div
                className={`w-full max-h-[90vh] bg-white rounded-2xl shadow-xl border border-gray-100 flex flex-col transition-[max-width] duration-200 ${
                    activeTab === 'add' ? 'max-w-md' : 'max-w-3xl'
                }`}
                onClick={(e) => e.stopPropagation()}
                role="dialog"
                aria-modal="true"
                aria-labelledby="admin-accounts-title"
            >
                <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 shrink-0">
                    <div className="flex items-center gap-3">
                        <span className="flex items-center justify-center w-10 h-10 rounded-xl bg-indigo-100 text-indigo-600">
                            <FaUsers className="w-5 h-5" />
                        </span>
                        <div>
                            <h2 id="admin-accounts-title" className="text-lg font-bold text-gray-900">
                                Manage accounts
                            </h2>
                            <p className="text-sm text-gray-500">Add, edit roles, reset passwords, or remove users</p>
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full"
                        aria-label="Close"
                    >
                        <FaTimes className="w-5 h-5" />
                    </button>
                </div>

                <div className="flex border-b border-gray-100 px-6 shrink-0">
                    <button
                        type="button"
                        onClick={() => setActiveTab('accounts')}
                        className={`px-4 py-3 text-sm font-medium border-b-2 -mb-px ${
                            activeTab === 'accounts'
                                ? 'border-indigo-600 text-indigo-700'
                                : 'border-transparent text-gray-500 hover:text-gray-700'
                        }`}
                    >
                        Accounts ({users.length})
                    </button>
                    <button
                        type="button"
                        onClick={() => setActiveTab('add')}
                        className={`px-4 py-3 text-sm font-medium border-b-2 -mb-px ${
                            activeTab === 'add'
                                ? 'border-indigo-600 text-indigo-700'
                                : 'border-transparent text-gray-500 hover:text-gray-700'
                        }`}
                    >
                        Add account
                    </button>
                </div>

                <div className={`flex-1 overflow-y-auto ${activeTab === 'add' ? 'p-6 sm:p-8' : 'p-6'}`}>
                    {activeTab === 'accounts' && feedback.message && (
                        <div className={`mb-4 rounded-lg px-3 py-2 text-sm ${
                            feedback.type === 'success'
                                ? 'bg-green-50 border border-green-200 text-green-700'
                                : 'bg-red-50 border border-red-200 text-red-700'
                        }`}>
                            {feedback.message}
                        </div>
                    )}

                    {activeTab === 'accounts' && (
                        <>
                            {isLoading ? (
                                <p className="text-sm text-gray-500 text-center py-8">Loading accounts...</p>
                            ) : users.length === 0 ? (
                                <p className="text-sm text-gray-500 text-center py-8">No accounts found.</p>
                            ) : (
                                <div className="overflow-x-auto border border-gray-200 rounded-xl">
                                    <table className="w-full text-left text-sm">
                                        <thead className="bg-gray-50 text-xs font-semibold uppercase tracking-wide text-gray-500">
                                            <tr>
                                                <th className="px-4 py-2.5">Username</th>
                                                <th className="px-4 py-2.5">Role</th>
                                                <th className="px-4 py-2.5 hidden md:table-cell">Joined</th>
                                                <th className="px-4 py-2.5 hidden lg:table-cell">Last login</th>
                                                <th className="px-4 py-2.5 w-28" />
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {users.map((account) => {
                                                const isEditing = editingId === account.id;
                                                const roleBadge = ROLE_BADGE_CLASSES[account.role] || 'text-gray-700 bg-gray-50 border-gray-200';
                                                const canManage = Boolean(account.can_manage);

                                                return (
                                                    <React.Fragment key={account.id}>
                                                        <tr className="border-t border-gray-100 hover:bg-gray-50/50">
                                                            <td className="px-4 py-3 font-medium text-gray-900">
                                                                {account.username}
                                                                {account.is_self && (
                                                                    <span className="ml-2 text-xs text-gray-400">(you)</span>
                                                                )}
                                                            </td>
                                                            <td className="px-4 py-3">
                                                                <span className={`text-xs border rounded px-2 py-0.5 ${roleBadge}`}>
                                                                    {ROLE_LABELS[account.role] || account.role}
                                                                </span>
                                                            </td>
                                                            <td className="px-4 py-3 text-gray-600 hidden md:table-cell">
                                                                {formatDate(account.date_joined)}
                                                            </td>
                                                            <td className="px-4 py-3 text-gray-600 hidden lg:table-cell">
                                                                {formatDate(account.last_login)}
                                                            </td>
                                                            <td className="px-4 py-3">
                                                                <div className="flex items-center justify-end gap-1">
                                                                    {canManage && !isEditing && (
                                                                        <>
                                                                            <button
                                                                                type="button"
                                                                                onClick={() => startEdit(account)}
                                                                                className="p-1.5 text-blue-600 hover:bg-blue-50 rounded"
                                                                                title="Edit account"
                                                                            >
                                                                                <FaPencilAlt className="w-3.5 h-3.5" />
                                                                            </button>
                                                                            <button
                                                                                type="button"
                                                                                onClick={() => handleDelete(account)}
                                                                                disabled={deletingId === account.id}
                                                                                className="p-1.5 text-red-600 hover:bg-red-50 rounded disabled:opacity-50"
                                                                                title="Remove account"
                                                                            >
                                                                                <FaTrash className="w-3.5 h-3.5" />
                                                                            </button>
                                                                        </>
                                                                    )}
                                                                    {!canManage && (
                                                                        <span className="text-xs text-gray-400">
                                                                            {account.is_self ? 'You' : 'Admin'}
                                                                        </span>
                                                                    )}
                                                                </div>
                                                            </td>
                                                        </tr>
                                                        {isEditing && (
                                                            <tr className="bg-blue-50/40 border-t border-blue-100">
                                                                <td colSpan={5} className="px-4 py-4">
                                                                    <div className="flex flex-col sm:flex-row sm:items-end gap-3">
                                                                        <div className="flex-1">
                                                                            <label className="block text-xs font-medium text-gray-700 mb-1">
                                                                                Role
                                                                            </label>
                                                                            <select
                                                                                value={editForm.role}
                                                                                onChange={(e) => setEditForm((prev) => ({
                                                                                    ...prev,
                                                                                    role: e.target.value,
                                                                                }))}
                                                                                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                                                                            >
                                                                                {ROLE_OPTIONS.map((option) => (
                                                                                    <option key={option.value} value={option.value}>
                                                                                        {option.label}
                                                                                    </option>
                                                                                ))}
                                                                            </select>
                                                                        </div>
                                                                        <div className="flex-1">
                                                                            <label className="block text-xs font-medium text-gray-700 mb-1">
                                                                                New password (optional)
                                                                            </label>
                                                                            <input
                                                                                type="password"
                                                                                value={editForm.password}
                                                                                onChange={(e) => setEditForm((prev) => ({
                                                                                    ...prev,
                                                                                    password: e.target.value,
                                                                                }))}
                                                                                placeholder="Leave blank to keep current"
                                                                                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                                                                                minLength={6}
                                                                            />
                                                                        </div>
                                                                        <div className="flex gap-2 shrink-0">
                                                                            <button
                                                                                type="button"
                                                                                onClick={() => handleSaveEdit(account)}
                                                                                disabled={isSaving}
                                                                                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-60"
                                                                            >
                                                                                {isSaving ? 'Saving...' : 'Save'}
                                                                            </button>
                                                                            <button
                                                                                type="button"
                                                                                onClick={cancelEdit}
                                                                                className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-800"
                                                                            >
                                                                                Cancel
                                                                            </button>
                                                                        </div>
                                                                    </div>
                                                                </td>
                                                            </tr>
                                                        )}
                                                    </React.Fragment>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </>
                    )}

                    {activeTab === 'add' && (
                        <form onSubmit={handleCreate} className="space-y-5">
                            <p className="text-sm text-gray-600 -mt-1">
                                Create a Drafter or Salesman account. Admin accounts cannot be added here.
                            </p>

                            {feedback.message && (
                                <div className={`rounded-lg px-3 py-2 text-sm ${
                                    feedback.type === 'success'
                                        ? 'bg-green-50 border border-green-200 text-green-700'
                                        : 'bg-red-50 border border-red-200 text-red-700'
                                }`}>
                                    {feedback.message}
                                </div>
                            )}

                            <div>
                                <label htmlFor="new-username" className="block text-sm font-medium text-gray-700 mb-1.5">
                                    Username
                                </label>
                                <input
                                    id="new-username"
                                    type="text"
                                    value={createForm.username}
                                    onChange={(e) => setCreateForm((prev) => ({
                                        ...prev,
                                        username: e.target.value,
                                    }))}
                                    placeholder="e.g. jsmith"
                                    className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                    required
                                    autoComplete="off"
                                    autoFocus
                                />
                            </div>
                            <div>
                                <label htmlFor="new-password" className="block text-sm font-medium text-gray-700 mb-1.5">
                                    Password
                                </label>
                                <input
                                    id="new-password"
                                    type="password"
                                    value={createForm.password}
                                    onChange={(e) => setCreateForm((prev) => ({
                                        ...prev,
                                        password: e.target.value,
                                    }))}
                                    className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                    required
                                    minLength={6}
                                />
                                <p className="text-xs text-gray-500 mt-1.5">Minimum 6 characters.</p>
                            </div>
                            <div>
                                <label htmlFor="new-role" className="block text-sm font-medium text-gray-700 mb-1.5">
                                    Role
                                </label>
                                <select
                                    id="new-role"
                                    value={createForm.role}
                                    onChange={(e) => setCreateForm((prev) => ({
                                        ...prev,
                                        role: e.target.value,
                                    }))}
                                    className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                >
                                    {ROLE_OPTIONS.map((option) => (
                                        <option key={option.value} value={option.value}>
                                            {option.label}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <div className="flex items-center justify-end gap-3 pt-1">
                                <button
                                    type="button"
                                    onClick={() => setActiveTab('accounts')}
                                    disabled={isCreating}
                                    className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-800 disabled:opacity-50"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    disabled={isCreating}
                                    className="inline-flex items-center px-5 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-60"
                                >
                                    <FaUserPlus className="w-4 h-4 mr-2" />
                                    {isCreating ? 'Creating...' : 'Create account'}
                                </button>
                            </div>
                        </form>
                    )}
                </div>
            </div>
        </ModalOverlay>
    );
};

export default AdminAccountsModal;
