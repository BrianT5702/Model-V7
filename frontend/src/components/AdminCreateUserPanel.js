import React, { useState } from 'react';
import { FaTimes, FaUserPlus } from 'react-icons/fa';
import { useAuth } from '../features/auth/AuthContext';

const AdminCreateUserPanel = ({ onClose }) => {
    const { registerUser } = useAuth();
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [feedback, setFeedback] = useState({ type: '', message: '' });

    const handleSubmit = async (event) => {
        event.preventDefault();
        setFeedback({ type: '', message: '' });
        setIsSubmitting(true);

        const result = await registerUser(username.trim(), password);

        setIsSubmitting(false);

        if (result.success) {
            setFeedback({ type: 'success', message: result.message });
            setUsername('');
            setPassword('');
        } else {
            setFeedback({ type: 'error', message: result.error });
        }
    };

    return (
        <div className="absolute right-0 top-full mt-2 w-72 sm:w-80 bg-white border border-gray-200 rounded-xl shadow-xl z-50 p-4">
            <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-gray-900">Create user account</h3>
                <button
                    type="button"
                    onClick={onClose}
                    className="p-1 text-gray-400 hover:text-gray-600 rounded"
                    aria-label="Close"
                >
                    <FaTimes className="w-4 h-4" />
                </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-3">
                <div>
                    <label htmlFor="admin-new-username" className="block text-xs font-medium text-gray-700 mb-1">
                        Username
                    </label>
                    <input
                        id="admin-new-username"
                        type="text"
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        autoComplete="off"
                        required
                    />
                </div>

                <div>
                    <label htmlFor="admin-new-password" className="block text-xs font-medium text-gray-700 mb-1">
                        Password
                    </label>
                    <input
                        id="admin-new-password"
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        autoComplete="new-password"
                        required
                        minLength={6}
                    />
                    <p className="text-xs text-gray-500 mt-1">Minimum 6 characters.</p>
                </div>

                {feedback.message && (
                    <div className={`rounded-lg px-3 py-2 text-xs ${
                        feedback.type === 'success'
                            ? 'bg-green-50 border border-green-200 text-green-700'
                            : 'bg-red-50 border border-red-200 text-red-700'
                    }`}>
                        {feedback.message}
                    </div>
                )}

                <button
                    type="submit"
                    disabled={isSubmitting}
                    className="w-full flex items-center justify-center px-3 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-60"
                >
                    <FaUserPlus className="w-4 h-4 mr-2" />
                    {isSubmitting ? 'Creating...' : 'Create account'}
                </button>
            </form>
        </div>
    );
};

export default AdminCreateUserPanel;
