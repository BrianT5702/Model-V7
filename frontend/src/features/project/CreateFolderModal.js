import React, { useEffect, useState } from 'react';
import { FaFolder, FaFolderPlus } from 'react-icons/fa';
import ModalOverlay from '../../components/ModalOverlay';
import { UNCATEGORIZED_KEY } from './projectFolderUtils';

const CreateFolderModal = ({
    isOpen,
    parentLabel,
    parentKey,
    onClose,
    onSubmit,
}) => {
    const [name, setName] = useState('');
    const [error, setError] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);

    const isTopLevel = parentKey === UNCATEGORIZED_KEY;
    const title = isTopLevel ? 'Create folder' : 'Create subfolder';

    useEffect(() => {
        if (isOpen) {
            setName('');
            setError('');
            setIsSubmitting(false);
        }
    }, [isOpen, parentKey]);

    if (!isOpen) {
        return null;
    }

    const handleSubmit = async (e) => {
        e.preventDefault();
        const trimmed = name.trim();
        if (!trimmed) {
            setError('Folder name is required.');
            return;
        }

        setIsSubmitting(true);
        setError('');

        try {
            await onSubmit(trimmed);
            onClose();
        } catch (err) {
            const message = err.response?.data?.name?.[0]
                || err.response?.data?.error
                || (typeof err.response?.data === 'object'
                    ? Object.values(err.response.data).flat().join(' ')
                    : null)
                || 'Failed to create folder. Please try again.';
            setError(message);
            setIsSubmitting(false);
        }
    };

    return (
        <ModalOverlay
            className="bg-black/50 flex items-center justify-center z-50 p-4"
            onClick={onClose}
        >
            <div
                className="w-full max-w-md bg-white rounded-2xl shadow-xl border border-gray-100 relative"
                onClick={(e) => e.stopPropagation()}
                role="dialog"
                aria-modal="true"
                aria-labelledby="create-folder-title"
            >
                <button
                    type="button"
                    onClick={onClose}
                    className="absolute top-4 right-4 p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full transition-colors"
                    aria-label="Close"
                >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                </button>

                <form onSubmit={handleSubmit} className="p-6 sm:p-8">
                    <div className="flex items-center gap-3 mb-2">
                        <span className="flex items-center justify-center w-10 h-10 rounded-xl bg-amber-100 text-amber-600">
                            <FaFolderPlus className="w-5 h-5" />
                        </span>
                        <h2 id="create-folder-title" className="text-xl font-bold text-gray-900">
                            {title}
                        </h2>
                    </div>

                    <p className="text-sm text-gray-600 mb-6">
                        {isTopLevel ? (
                            'Create a new folder at the top level.'
                        ) : (
                            <>
                                Inside{' '}
                                <span className="inline-flex items-center gap-1 font-medium text-gray-800">
                                    <FaFolder className="w-3.5 h-3.5 text-amber-500" />
                                    {parentLabel}
                                </span>
                            </>
                        )}
                    </p>

                    <label htmlFor="folder-name" className="block text-sm font-medium text-gray-700 mb-1.5">
                        Folder name
                    </label>
                    <input
                        id="folder-name"
                        type="text"
                        value={name}
                        onChange={(e) => {
                            setName(e.target.value);
                            if (error) setError('');
                        }}
                        placeholder={isTopLevel ? 'e.g. Client projects' : 'e.g. 2025'}
                        className="w-full px-3 py-2.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        autoFocus
                        disabled={isSubmitting}
                    />

                    {error && (
                        <p className="mt-2 text-sm text-red-600">{error}</p>
                    )}

                    <div className="mt-6 flex items-center justify-end gap-3">
                        <button
                            type="button"
                            onClick={onClose}
                            disabled={isSubmitting}
                            className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-800 disabled:opacity-50"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={isSubmitting}
                            className="px-5 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-60"
                        >
                            {isSubmitting ? 'Creating...' : 'Create folder'}
                        </button>
                    </div>
                </form>
            </div>
        </ModalOverlay>
    );
};

export default CreateFolderModal;
