import { useEffect, useRef, useState } from 'react';

import type { BackendDescriptor, BackendId } from '../../../shared/protocol/backends.ts';
import type { WorkspaceFolder } from '../hooks/useExtensionMessages.js';
import { SettingsModal } from './SettingsModal.js';

interface BottomToolbarProps {
  isEditMode: boolean;
  onCreateSession: (options?: {
    backendId?: BackendId;
    folderPath?: string;
    bypassPermissions?: boolean;
  }) => void;
  onToggleEditMode: () => void;
  isDebugMode: boolean;
  onToggleDebugMode: () => void;
  alwaysShowOverlay: boolean;
  onToggleAlwaysShowOverlay: () => void;
  workspaceFolders: WorkspaceFolder[];
  externalAssetDirectories: string[];
  availableBackends: BackendDescriptor[];
  selectedBackendId: BackendId;
  onSelectedBackendChange: (backendId: BackendId) => void;
}

const panelStyle: React.CSSProperties = {
  position: 'absolute',
  bottom: 10,
  left: 10,
  zIndex: 'var(--pixel-controls-z)',
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  background: 'var(--pixel-bg)',
  border: '2px solid var(--pixel-border)',
  borderRadius: 0,
  padding: '4px 6px',
  boxShadow: 'var(--pixel-shadow)',
};

const btnBase: React.CSSProperties = {
  padding: '5px 10px',
  fontSize: '24px',
  color: 'var(--pixel-text)',
  background: 'var(--pixel-btn-bg)',
  border: '2px solid transparent',
  borderRadius: 0,
  cursor: 'pointer',
};

const btnActive: React.CSSProperties = {
  ...btnBase,
  background: 'var(--pixel-active-bg)',
  border: '2px solid var(--pixel-accent)',
};

export function BottomToolbar({
  isEditMode,
  onCreateSession,
  onToggleEditMode,
  isDebugMode,
  onToggleDebugMode,
  alwaysShowOverlay,
  onToggleAlwaysShowOverlay,
  workspaceFolders,
  externalAssetDirectories,
  availableBackends,
  selectedBackendId,
  onSelectedBackendChange,
}: BottomToolbarProps) {
  const [hovered, setHovered] = useState<string | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isFolderPickerOpen, setIsFolderPickerOpen] = useState(false);
  const [isBypassMenuOpen, setIsBypassMenuOpen] = useState(false);
  const [isBackendMenuOpen, setIsBackendMenuOpen] = useState(false);
  const [hoveredFolder, setHoveredFolder] = useState<number | null>(null);
  const [hoveredBypass, setHoveredBypass] = useState<number | null>(null);
  const [hoveredBackend, setHoveredBackend] = useState<number | null>(null);
  const sessionMenuRef = useRef<HTMLDivElement>(null);
  const pendingBypassRef = useRef(false);

  // Close folder picker / bypass menu on outside click
  useEffect(() => {
    if (!isFolderPickerOpen && !isBypassMenuOpen && !isBackendMenuOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (sessionMenuRef.current && !sessionMenuRef.current.contains(e.target as Node)) {
        setIsFolderPickerOpen(false);
        setIsBypassMenuOpen(false);
        setIsBackendMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [isFolderPickerOpen, isBypassMenuOpen, isBackendMenuOpen]);

  const hasMultipleFolders = workspaceFolders.length > 1;
  const selectedBackend =
    availableBackends.find((backend) => backend.id === selectedBackendId) ?? availableBackends[0];
  const supportsBypassPermissions = selectedBackend?.supportsBypassPermissions ?? false;

  const handleAgentClick = () => {
    setIsBackendMenuOpen(false);
    setIsBypassMenuOpen(false);
    pendingBypassRef.current = false;
    if (hasMultipleFolders) {
      setIsFolderPickerOpen((v) => !v);
    } else {
      onCreateSession({ backendId: selectedBackendId });
    }
  };

  const handleAgentRightClick = (e: React.MouseEvent) => {
    if (!supportsBypassPermissions) return;
    e.preventDefault();
    setIsBackendMenuOpen(false);
    setIsFolderPickerOpen(false);
    setIsBypassMenuOpen((v) => !v);
  };

  const handleFolderSelect = (folder: WorkspaceFolder) => {
    setIsFolderPickerOpen(false);
    const bypassPermissions = pendingBypassRef.current;
    pendingBypassRef.current = false;
    onCreateSession({
      backendId: selectedBackendId,
      folderPath: folder.path,
      bypassPermissions,
    });
  };

  const handleBypassSelect = (bypassPermissions: boolean) => {
    setIsBypassMenuOpen(false);
    if (hasMultipleFolders) {
      pendingBypassRef.current = bypassPermissions;
      setIsFolderPickerOpen(true);
    } else {
      onCreateSession({ backendId: selectedBackendId, bypassPermissions });
    }
  };

  return (
    <div style={panelStyle}>
      <div ref={sessionMenuRef} style={{ position: 'relative', display: 'flex', gap: 4 }}>
        <button
          onClick={() => {
            setIsFolderPickerOpen(false);
            setIsBypassMenuOpen(false);
            setIsBackendMenuOpen((v) => !v);
          }}
          onMouseEnter={() => setHovered('backend')}
          onMouseLeave={() => setHovered(null)}
          style={{
            ...btnBase,
            padding: '5px 10px',
            maxWidth: 190,
            background:
              hovered === 'backend' || isBackendMenuOpen
                ? 'var(--pixel-btn-hover-bg)'
                : 'var(--pixel-btn-bg)',
            border: '2px solid var(--pixel-border)',
            color: selectedBackend?.isImplemented ? 'var(--pixel-text)' : 'var(--pixel-text-dim)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
          title="Select backend"
        >
          {selectedBackend?.displayName ?? 'Backend'}
        </button>
        <button
          onClick={handleAgentClick}
          onContextMenu={handleAgentRightClick}
          onMouseEnter={() => setHovered('agent')}
          onMouseLeave={() => setHovered(null)}
          style={{
            ...btnBase,
            padding: '5px 12px',
            background:
              hovered === 'agent' || isFolderPickerOpen || isBypassMenuOpen
                ? 'var(--pixel-agent-hover-bg)'
                : 'var(--pixel-agent-bg)',
            border: '2px solid var(--pixel-agent-border)',
            color: 'var(--pixel-agent-text)',
          }}
          title={
            supportsBypassPermissions
              ? `Create ${selectedBackend?.displayName ?? 'agent'} session`
              : `Create ${selectedBackend?.displayName ?? 'agent'} session`
          }
        >
          + Agent
        </button>
        {isBackendMenuOpen && (
          <div
            style={{
              position: 'absolute',
              bottom: '100%',
              left: 0,
              marginBottom: 4,
              background: 'var(--pixel-bg)',
              border: '2px solid var(--pixel-border)',
              borderRadius: 0,
              boxShadow: 'var(--pixel-shadow)',
              minWidth: 210,
              zIndex: 'var(--pixel-controls-z)',
            }}
          >
            {availableBackends.map((backend, i) => {
              const isSelected = backend.id === selectedBackendId;
              const isDisabled = !backend.isImplemented;
              return (
                <button
                  key={backend.id}
                  onClick={() => {
                    if (isDisabled) return;
                    onSelectedBackendChange(backend.id);
                    setIsBackendMenuOpen(false);
                    setIsBypassMenuOpen(false);
                    pendingBypassRef.current = false;
                  }}
                  onMouseEnter={() => setHoveredBackend(i)}
                  onMouseLeave={() => setHoveredBackend(null)}
                  style={{
                    display: 'block',
                    width: '100%',
                    textAlign: 'left',
                    padding: '6px 10px',
                    fontSize: '22px',
                    color: isDisabled
                      ? 'var(--pixel-text-dim)'
                      : isSelected
                        ? 'var(--pixel-accent)'
                        : 'var(--pixel-text)',
                    background: hoveredBackend === i ? 'var(--pixel-btn-hover-bg)' : 'transparent',
                    border: 'none',
                    borderRadius: 0,
                    cursor: isDisabled ? 'default' : 'pointer',
                    whiteSpace: 'nowrap',
                    opacity: isDisabled ? 0.7 : 1,
                  }}
                >
                  {backend.displayName}
                  {!backend.isImplemented ? ' (Soon)' : isSelected ? ' *' : ''}
                </button>
              );
            })}
          </div>
        )}
        {isBypassMenuOpen && (
          <div
            style={{
              position: 'absolute',
              bottom: '100%',
              left: 0,
              marginBottom: 4,
              background: 'var(--pixel-bg)',
              border: '2px solid var(--pixel-border)',
              borderRadius: 0,
              padding: 4,
              boxShadow: 'var(--pixel-shadow)',
              minWidth: 180,
              zIndex: 'var(--pixel-controls-z)',
            }}
          >
            <button
              onClick={() => handleBypassSelect(false)}
              onMouseEnter={() => setHoveredBypass(0)}
              onMouseLeave={() => setHoveredBypass(null)}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                padding: '6px 10px',
                fontSize: '24px',
                color: 'var(--pixel-text)',
                background: hoveredBypass === 0 ? 'rgba(255, 255, 255, 0.08)' : 'transparent',
                border: 'none',
                borderRadius: 0,
                cursor: 'pointer',
              }}
            >
              Normal
            </button>
            <div style={{ height: 1, margin: '4px 0', background: 'var(--pixel-border)' }} />
            <button
              onClick={() => handleBypassSelect(true)}
              onMouseEnter={() => setHoveredBypass(1)}
              onMouseLeave={() => setHoveredBypass(null)}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                padding: '6px 10px',
                fontSize: '24px',
                color: 'var(--pixel-warning-text)',
                background: hoveredBypass === 1 ? 'rgba(255, 255, 255, 0.08)' : 'transparent',
                border: 'none',
                borderRadius: 0,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              <span style={{ fontSize: '16px' }}>⚡</span> Bypass Permissions
            </button>
          </div>
        )}
        {isFolderPickerOpen && (
          <div
            style={{
              position: 'absolute',
              bottom: '100%',
              left: 0,
              marginBottom: 4,
              background: 'var(--pixel-bg)',
              border: '2px solid var(--pixel-border)',
              borderRadius: 0,
              boxShadow: 'var(--pixel-shadow)',
              minWidth: 160,
              zIndex: 'var(--pixel-controls-z)',
            }}
          >
            {workspaceFolders.map((folder, i) => (
              <button
                key={folder.path}
                onClick={() => handleFolderSelect(folder)}
                onMouseEnter={() => setHoveredFolder(i)}
                onMouseLeave={() => setHoveredFolder(null)}
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  padding: '6px 10px',
                  fontSize: '22px',
                  color: 'var(--pixel-text)',
                  background: hoveredFolder === i ? 'var(--pixel-btn-hover-bg)' : 'transparent',
                  border: 'none',
                  borderRadius: 0,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                {folder.name}
              </button>
            ))}
          </div>
        )}
      </div>
      <button
        onClick={onToggleEditMode}
        onMouseEnter={() => setHovered('edit')}
        onMouseLeave={() => setHovered(null)}
        style={
          isEditMode
            ? { ...btnActive }
            : {
                ...btnBase,
                background: hovered === 'edit' ? 'var(--pixel-btn-hover-bg)' : btnBase.background,
              }
        }
        title="Edit office layout"
      >
        Layout
      </button>
      <div style={{ position: 'relative' }}>
        <button
          onClick={() => setIsSettingsOpen((v) => !v)}
          onMouseEnter={() => setHovered('settings')}
          onMouseLeave={() => setHovered(null)}
          style={
            isSettingsOpen
              ? { ...btnActive }
              : {
                  ...btnBase,
                  background:
                    hovered === 'settings' ? 'var(--pixel-btn-hover-bg)' : btnBase.background,
                }
          }
          title="Settings"
        >
          Settings
        </button>
        <SettingsModal
          isOpen={isSettingsOpen}
          onClose={() => setIsSettingsOpen(false)}
          isDebugMode={isDebugMode}
          onToggleDebugMode={onToggleDebugMode}
          alwaysShowOverlay={alwaysShowOverlay}
          onToggleAlwaysShowOverlay={onToggleAlwaysShowOverlay}
          externalAssetDirectories={externalAssetDirectories}
          selectedBackendId={selectedBackendId}
        />
      </div>
    </div>
  );
}
