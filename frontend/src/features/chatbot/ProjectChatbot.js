import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  UNCATEGORIZED_KEY,
  folderKeyToId,
  getNextListOrder,
  mergeProjectFolderMeta,
} from '../project/projectFolderUtils';
import ProjectFolderAssignStep from '../project/ProjectFolderAssignStep';
import api from '../../api/api';
import {
  PHASES,
  createInitialDraft,
  getWelcomeMessages,
  processChatMessage,
} from './chatbotEngine';
import { getSortedFolderEntries } from './parseChatMessage';
import { createProjectFromChatDraft } from './createFromChatPlan';

let messageId = 0;
function withId(msg) {
  messageId += 1;
  return { id: messageId, ...msg };
}

const ProjectChatbot = ({
  projects = [],
  setProjects,
  onClose,
  folders = [],
  setFolders,
  foldersAvailable = false,
  onFolderAssigned,
  variant = 'page', // 'page' | 'panel'
}) => {
  const isPanel = variant === 'panel';
  const navigate = useNavigate();
  const [phase, setPhase] = useState(PHASES.WELCOME);
  const [draft, setDraft] = useState(createInitialDraft);
  const [messages, setMessages] = useState(() => getWelcomeMessages().map(withId));
  const [input, setInput] = useState('');
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState('');
  const [step, setStep] = useState('chat');
  const [createdProject, setCreatedProject] = useState(null);
  const [assignFolderKey, setAssignFolderKey] = useState(UNCATEGORIZED_KEY);
  const [isAssigning, setIsAssigning] = useState(false);
  const [assignError, setAssignError] = useState('');
  const listRef = useRef(null);

  const chatOptions = { folders, foldersAvailable };

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages, isBusy]);

  const updateProjectInList = (project) => {
    setProjects((prevProjects) => {
      const exists = prevProjects.some((p) => p.id === project.id);
      if (exists) {
        return prevProjects.map((p) => (p.id === project.id ? { ...p, ...project } : p));
      }
      return [...prevProjects, project];
    });
  };

  const getProjectsSnapshot = (project) => (
    projects.some((p) => p.id === project.id) ? projects : [...projects, project]
  );

  const assignProjectToFolder = async (project, folderKey, projectsSnapshot = getProjectsSnapshot(project)) => {
    const targetFolderId = folderKeyToId(folderKey);
    const listOrder = getNextListOrder(projectsSnapshot, folderKey);
    const response = await api.patch(`projects/${project.id}/`, {
      folder: targetFolderId,
      list_order: listOrder,
    });
    return mergeProjectFolderMeta(response.data, folderKey, folders);
  };

  const finishWithFolder = (folderKey, project) => {
    onFolderAssigned?.(folderKey);
    if (project?.id) {
      navigate(`/projects/${project.id}`);
    } else if (onClose) {
      onClose();
    }
  };

  const handleAssignConfirm = async () => {
    if (!createdProject) return;
    setIsAssigning(true);
    setAssignError('');
    try {
      const updated = await assignProjectToFolder(createdProject, assignFolderKey);
      updateProjectInList(updated);
      finishWithFolder(assignFolderKey, updated);
    } catch (err) {
      setAssignError('Failed to save the project to that folder. Please try again.');
    } finally {
      setIsAssigning(false);
    }
  };

  const handleAssignSkip = () => {
    finishWithFolder(UNCATEGORIZED_KEY, createdProject);
  };

  const runCreate = async (planDraft) => {
    setIsBusy(true);
    setError('');
    try {
      const { project, rooms } = await createProjectFromChatDraft(planDraft);
      updateProjectInList(project);

      const roomNote = rooms.length
        ? ` Created ${rooms.length} room(s) with shared walls where rooms touch.`
        : ' Site and boundary walls are ready.';

      const folderNote = planDraft.folderDecided && planDraft.folderLabel
        ? ` Saved to folder **${planDraft.folderLabel}**.`
        : '';

      setMessages((prev) => [
        ...prev,
        withId({
          role: 'assistant',
          text: `Done! Project **${project.name}** is ready.${folderNote}${roomNote}\nOpening the project…`,
        }),
      ]);
      setPhase(PHASES.DONE);
      setCreatedProject(project);

      const folderKey = planDraft.folderDecided
        ? (planDraft.folderKey ?? UNCATEGORIZED_KEY)
        : UNCATEGORIZED_KEY;

      if (foldersAvailable) {
        const updated = await assignProjectToFolder(project, folderKey);
        updateProjectInList(updated);
        finishWithFolder(folderKey, updated);
        return;
      }

      finishWithFolder(UNCATEGORIZED_KEY, project);
    } catch (err) {
      console.error('Chatbot create failed:', err);
      const data = err.response?.data;
      let detail = err.message || 'Creation failed.';
      if (typeof data === 'string') {
        detail = data;
      } else if (data?.error) {
        detail = data.error;
      } else if (data?.name?.[0]) {
        detail = data.name[0];
      } else if (data && typeof data === 'object') {
        const parts = Object.entries(data).map(([key, val]) => {
          const msg = Array.isArray(val) ? val.join(', ') : String(val);
          return `${key}: ${msg}`;
        });
        if (parts.length) detail = parts.join('; ');
      }
      setError(detail);
      setPhase(PHASES.CONFIRM);
      setMessages((prev) => [
        ...prev,
        withId({
          role: 'assistant',
          text: `I couldn't create the project: ${detail}\nYou can fix the details and say **create** again, or **restart**.`,
        }),
      ]);
    } finally {
      setIsBusy(false);
    }
  };

  const sendText = async (userText) => {
    if (isBusy || !userText.trim()) return;
    setInput('');
    setMessages((prev) => [...prev, withId({ role: 'user', text: userText.trim() })]);

    const result = processChatMessage(phase, draft, userText.trim(), chatOptions);
    setDraft(result.draft);
    setPhase(result.phase);
    setMessages((prev) => [...prev, ...result.messages.map(withId)]);

    if (result.readyToCreate) {
      await runCreate(result.draft);
    }
  };

  const handleSend = async (e) => {
    e?.preventDefault?.();
    await sendText(input);
  };

  const handleQuick = (text) => {
    sendText(text);
  };

  const shellClass = isPanel
    ? 'w-full bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 relative flex flex-col h-[min(70vh,560px)]'
    : 'max-w-4xl mx-auto bg-white dark:bg-gray-900 rounded-2xl shadow-xl border border-gray-100 dark:border-gray-800 relative flex flex-col min-h-[520px] max-h-[80vh]';

  const headerPad = isPanel ? 'px-4 pt-4 pb-2' : 'px-6 pt-6 pb-3';
  const bodyPad = isPanel ? 'px-4 py-3' : 'px-6 py-4';
  const footerPad = isPanel ? 'px-4 pb-4 pt-2' : 'px-6 pb-6 pt-2';

  if (step === 'assign-folder' && createdProject) {
    return (
      <div className={isPanel
        ? 'w-full bg-white dark:bg-gray-900 p-4 border border-gray-200 dark:border-gray-700 relative'
        : 'max-w-4xl mx-auto bg-white dark:bg-gray-900 p-6 sm:p-8 rounded-2xl shadow-xl border border-gray-100 dark:border-gray-800 relative'
      }>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="absolute top-3 right-3 p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-full"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
        <ProjectFolderAssignStep
          projectName={createdProject.name}
          folders={folders}
          setFolders={setFolders}
          selectedFolderKey={assignFolderKey}
          onSelectedFolderKeyChange={setAssignFolderKey}
          onConfirm={handleAssignConfirm}
          onSkip={handleAssignSkip}
          isSubmitting={isAssigning}
          error={assignError}
        />
      </div>
    );
  }

  return (
    <div className={shellClass}>
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          className="absolute top-3 right-3 z-10 p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-full"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}

      <div className={`${headerPad} border-b border-gray-100 dark:border-gray-800`}>
        <h2 className={`${isPanel ? 'text-lg' : 'text-2xl'} font-bold text-gray-900 dark:text-gray-100 pr-10`}>
          Project Chat Assistant
        </h2>
        <p className="text-xs sm:text-sm text-gray-500 dark:text-gray-400 mt-1">
          Ask me to create a project — I&apos;ll ask where to place it if you don&apos;t say a folder, then collect size, rooms, and finishes.
        </p>
      </div>

      <div ref={listRef} className={`flex-1 overflow-y-auto ${bodyPad} space-y-3`}>
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap ${
                msg.role === 'user'
                  ? 'bg-blue-600 text-white rounded-br-md'
                  : 'bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-100 rounded-bl-md'
              }`}
            >
              {msg.text.split(/(\*\*[^*]+\*\*)/).map((part, i) => {
                if (part.startsWith('**') && part.endsWith('**')) {
                  return <strong key={i}>{part.slice(2, -2)}</strong>;
                }
                return <span key={i}>{part}</span>;
              })}
            </div>
          </div>
        ))}
        {isBusy && (
          <div className="text-sm text-gray-500 dark:text-gray-400 animate-pulse">
            Working…
          </div>
        )}
      </div>

      {error && (
        <div className={`${isPanel ? 'mx-4' : 'mx-6'} mb-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2`}>
          {error}
        </div>
      )}

      <div className={`${isPanel ? 'px-4' : 'px-6'} pb-2 flex flex-wrap gap-2`}>
        {phase === PHASES.WELCOME && (
          <button type="button" onClick={() => handleQuick('Help me create a project')} className="text-xs px-3 py-1 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-700">
            Help me create a project
          </button>
        )}
        {phase === PHASES.FOLDER && (
          <>
            {getSortedFolderEntries(folders).slice(0, 4).map((entry) => (
              <button
                key={entry.folder.id}
                type="button"
                onClick={() => handleQuick(entry.pathSlash)}
                className="text-xs px-3 py-1 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200"
              >
                {entry.path}
              </button>
            ))}
            <button type="button" onClick={() => handleQuick('uncategorized')} className="text-xs px-3 py-1 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200">
              Uncategorized
            </button>
          </>
        )}
        {phase === PHASES.WALL_THICKNESS && (
          <button type="button" onClick={() => handleQuick('default')} className="text-xs px-3 py-1 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200">
            Default 200 mm
          </button>
        )}
        {phase === PHASES.ROOM_INTENT && (
          <>
            <button type="button" onClick={() => handleQuick('1 room')} className="text-xs px-3 py-1 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200">
              1 room
            </button>
            <button type="button" onClick={() => handleQuick('yes, 2 rooms')} className="text-xs px-3 py-1 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200">
              Yes, 2 rooms
            </button>
            <button type="button" onClick={() => handleQuick('no')} className="text-xs px-3 py-1 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200">
              No rooms
            </button>
          </>
        )}
        {phase === PHASES.ROOM_SIZE && (
          <button type="button" onClick={() => handleQuick('follow the project size')} className="text-xs px-3 py-1 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200">
            Follow project size
          </button>
        )}
        {phase === PHASES.CONFIRM && (
          <button type="button" onClick={() => handleQuick('create')} className="text-xs px-3 py-1 rounded-full bg-blue-100 text-blue-800">
            Create project
          </button>
        )}
      </div>

      <form onSubmit={handleSend} className={`${footerPad} flex gap-2 border-t border-gray-100 dark:border-gray-800`}>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={isBusy || phase === PHASES.CREATING}
          placeholder="Type your reply…"
          className="flex-1 rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:text-gray-100"
        />
        <button
          type="submit"
          disabled={isBusy || !input.trim() || phase === PHASES.CREATING}
          className="px-4 py-2 rounded-xl bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
        >
          Send
        </button>
      </form>
    </div>
  );
};

export default ProjectChatbot;
