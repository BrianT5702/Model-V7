import React, { useState } from 'react';
import { FaComments, FaTimes } from 'react-icons/fa';
import ProjectChatbot from './ProjectChatbot';

/**
 * Floating lower-right launcher for the project creation chatbot.
 */
const ChatbotFab = ({
  projects,
  setProjects,
  folders,
  setFolders,
  foldersAvailable,
  onFolderAssigned,
}) => {
  const [open, setOpen] = useState(false);

  return (
    <div className="fixed bottom-5 right-5 z-50 flex flex-col items-end gap-3 pointer-events-none">
      {open && (
        <div className="pointer-events-auto w-[min(100vw-1.5rem,24rem)] sm:w-[26rem] shadow-2xl rounded-2xl overflow-hidden">
          <ProjectChatbot
            variant="panel"
            projects={projects}
            setProjects={setProjects}
            folders={folders}
            setFolders={setFolders}
            foldersAvailable={foldersAvailable}
            onFolderAssigned={onFolderAssigned}
            onClose={() => setOpen(false)}
          />
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="pointer-events-auto w-14 h-14 rounded-full bg-blue-600 hover:bg-blue-700 text-white shadow-lg hover:shadow-xl flex items-center justify-center transition-transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-2"
        title={open ? 'Close chat assistant' : 'Open chat assistant to create a project'}
        aria-label={open ? 'Close chat assistant' : 'Open chat assistant'}
      >
        {open ? <FaTimes className="w-5 h-5" /> : <FaComments className="w-6 h-6" />}
      </button>
    </div>
  );
};

export default ChatbotFab;
