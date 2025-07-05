import React, { useState, useEffect } from 'react';
import useDoorForm from './useDoorForm';

const DoorEditorModal = ({ door, onUpdate, onDelete, onClose }) => {
  const form = useDoorForm({
    initialDoor: door,
    isEditMode: true,
    onUpdate,
    onDelete,
    onClose
  });

  return (
    <div className="fixed inset-0 bg-black bg-opacity-30 flex justify-center items-center z-50">
      <div className="bg-white p-6 rounded-lg shadow-lg w-full max-w-md">
        <h2 className="text-lg font-semibold mb-4">Edit Door</h2>

        <div className="space-y-4">
          <label className="block">
            <span className="text-sm font-medium text-gray-700">Door Type</span>
            <select
              value={form.doorType}
              onChange={form.handleTypeChange}
              className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md"
            >
              <option value="swing">Swing</option>
              <option value="slide">Slide</option>
            </select>
          </label>

          <label className="block">
            <span className="text-sm font-medium text-gray-700">Configuration</span>
            <select
              value={form.configuration}
              onChange={form.handleConfigChange}
              className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md"
            >
              <option value="single_sided">Single-Sided</option>
              <option value="double_sided">Double-Sided</option>
            </select>
          </label>

          <label className="block">
            <span className="text-sm font-medium text-gray-700">Width (mm)</span>
            <input
              type="number"
              value={form.width}
              onChange={e => form.setWidth(e.target.value)}
              min="100"
              step="100"
              className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md"
            />
          </label>

          <label className="block">
            <span className="text-sm font-medium text-gray-700">Height (mm)</span>
            <input
              type="number"
              value={form.height}
              onChange={e => form.setHeight(e.target.value)}
              min="100"
              step="100"
              className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md"
            />
          </label>

          <label className="block">
            <span className="text-sm font-medium text-gray-700">Thickness (mm)</span>
            <input
              type="number"
              value={form.thickness}
              onChange={e => form.setThickness(e.target.value)}
              min="25"
              step="25"
              className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md"
            />
          </label>

          <label className="block">
            <span className="text-sm font-medium text-gray-700">Position on Wall</span>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={form.position_x}
              onChange={form.handlePositionChange}
              className="w-full"
            />
          </label>

          <div className="flex gap-3">
            <button
              onClick={form.handleFlipDirection}
              className="flex-1 bg-blue-500 text-white py-2 px-4 rounded hover:bg-blue-600"
            >
              Flip Opening Direction
            </button>

            <button
              onClick={form.handleFlipSide}
              className="flex-1 bg-purple-500 text-white py-2 px-4 rounded hover:bg-purple-600"
            >
              Flip Installing Side
            </button>
          </div>
        </div>

        <div className="flex justify-end gap-3 mt-6">
          <button
            onClick={onClose}
            className="bg-gray-200 text-gray-700 px-4 py-2 rounded hover:bg-gray-300"
          >
            Cancel
          </button>
          <button
            onClick={form.handleDelete}
            className="bg-red-500 text-white px-4 py-2 rounded hover:bg-red-600"
          >
            Delete
          </button>
          <button
            onClick={form.handleSave}
            className="bg-green-500 text-white px-4 py-2 rounded hover:bg-green-600"
          >
            Save
          </button>
        </div>
      </div>

      {form.showDeleteConfirm && (
        <div className="fixed top-20 left-1/2 transform -translate-x-1/2 z-50 bg-yellow-100 border border-yellow-400 text-yellow-800 px-4 py-3 rounded shadow-lg flex items-center gap-4">
          <svg className="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
          </svg>
          <span className="font-medium">Are you sure you want to delete this door?</span>
          <button onClick={form.handleConfirmDelete} className="ml-4 px-3 py-1 bg-red-500 text-white rounded hover:bg-red-600">Yes, Delete</button>
          <button onClick={() => form.setShowDeleteConfirm(false)} className="px-3 py-1 bg-gray-300 text-gray-800 rounded hover:bg-gray-400">Cancel</button>
        </div>
      )}

      {form.dbConnectionError && (
        <div className="fixed top-4 left-1/2 transform -translate-x-1/2 z-50 bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded shadow-lg">
          <div className="flex items-center">
            <svg className="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
            <span className="font-medium">Fail to connect to database. Try again later.</span>
          </div>
        </div>
      )}

      {form.validationError && (
        <div className="fixed top-4 left-1/2 transform -translate-x-1/2 z-50 bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded shadow-lg">
          <div className="flex items-center">
            <svg className="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
            <span className="font-medium">{form.validationError}</span>
          </div>
        </div>
      )}
    </div>
  );
};

export default DoorEditorModal;
