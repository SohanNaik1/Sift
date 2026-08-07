import './style.css';
import * as Sentry from '@sentry/browser';
// @ts-ignore
import {ListFiles, GetQuickTargets, TrashFile, MoveFile, GetFilePreview, Quit, PickDirectory, OpenNative, GetTrashPath, PinTarget, CheckForUpdates} from '../wailsjs/go/gui/Controller';
// @ts-ignore
import {BrowserOpenURL} from '../wailsjs/runtime/runtime';

interface FileEntry {
    name: string;
    path: string;
    isDir: boolean;
    sizeMB: number;
    modTime: string;
    perms: string;
    previewType: string;
    mime: string;
    ext: string;
    isHidden: boolean;
}

let currentPath = '~';
let allFiles: FileEntry[] = [];
let files: FileEntry[] = [];
let selectedIndex = 0;
let quickTargets: Record<string, string> = {};
let previewDebounceTimer: number | null = null;

const fileListEl = document.getElementById('file-list') as HTMLUListElement;
const currentPathEl = document.getElementById('current-path') as HTMLDivElement;
const previewTitleEl = document.getElementById('preview-title') as HTMLHeadingElement;
const fileMetaEl = document.getElementById('file-meta') as HTMLDivElement;
const previewContentEl = document.getElementById('preview-content') as HTMLDivElement;

const searchBar = document.getElementById('search-bar') as HTMLInputElement;
const btnOpen = document.getElementById('btn-open') as HTMLButtonElement;
const btnTrash = document.getElementById('btn-trash') as HTMLButtonElement;
const btnTrashPortal = document.getElementById('btn-trash-portal') as HTMLButtonElement;
const btnHotkeys = document.getElementById('btn-hotkeys') as HTMLButtonElement;
const btnHome = document.getElementById('btn-home') as HTMLButtonElement;
const btnQuit = document.getElementById('btn-quit') as HTMLButtonElement;
const mouseTargets = document.getElementById('quick-targets-modal-group') as HTMLDivElement;
const modal = document.getElementById('hotkey-modal') as HTMLDivElement;
const btnCloseModal = document.getElementById('btn-close-modal') as HTMLButtonElement;

// Sentry Frontend Telemetry (only if DSN is provided)
const sentryDsn = "YOUR_SENTRY_DSN_HERE";
if (sentryDsn !== "YOUR_SENTRY_DSN_HERE") {
    Sentry.init({
      dsn: sentryDsn,
    });
}

async function init() {


    // 2. Check for Updates
    const CURRENT_VERSION = "v1.0.0";
    const newVersion = await CheckForUpdates(CURRENT_VERSION);
    if (newVersion) {
        const banner = document.getElementById('update-banner');
        if (banner) {
            banner.style.display = 'block';
            banner.onclick = () => BrowserOpenURL("https://github.com/SohanNaik1/Sift/releases/latest");
        }
    }

    quickTargets = await GetQuickTargets();
    renderQuickTargets();
    setupMouseControls();
    await loadDirectory(currentPath);
    setupKeyboardListeners();
    setupSearch();
}

function renderQuickTargets() {
    mouseTargets.innerHTML = '';
    for (const [key, path] of Object.entries(quickTargets)) {
        const wrapper = document.createElement('div');
        wrapper.style.display = 'inline-flex';
        wrapper.style.margin = '4px';
        
        const btn = document.createElement('button');
        btn.className = 'action-btn';
        btn.style.borderRadius = 'var(--radius-sm) 0 0 var(--radius-sm)';
        btn.innerHTML = `${key}: ${path.split('/').pop() || path}`;
        btn.title = `Move to ${path}`;
        btn.onclick = () => {
            modal.style.display = 'none';
            handleMove(key);
        };
        
        const unpinBtn = document.createElement('button');
        unpinBtn.className = 'action-btn danger';
        unpinBtn.style.borderRadius = '0 var(--radius-sm) var(--radius-sm) 0';
        unpinBtn.style.borderLeft = 'none';
        unpinBtn.style.padding = '4px 8px';
        unpinBtn.innerHTML = '&times;';
        const isPinned = Object.values(quickTargets).includes(path);
        if (isPinned) {
            unpinBtn.classList.add('pinned');
            unpinBtn.title = "Unpin directory";
        } else {
            unpinBtn.title = "Pin to quick move";
        }

        unpinBtn.onclick = async (e) => {
            e.stopPropagation(); // prevent row click
            quickTargets = await PinTarget(path);
            
            // Toggle visual state
            if (unpinBtn.classList.contains('pinned')) {
                unpinBtn.classList.remove('pinned');
                unpinBtn.title = "Pin to quick move";
            } else {
                unpinBtn.classList.add('pinned');
                unpinBtn.title = "Unpin directory";
            }
            
            renderQuickTargets();
        };wrapper.appendChild(unpinBtn);
        mouseTargets.appendChild(wrapper);
    }
}

function setupMouseControls() {
    btnOpen.onclick = handleAction;
    btnTrash.onclick = handleTrash;
    btnTrashPortal.onclick = async () => {
        const trashPath = await GetTrashPath();
        searchBar.value = '';
        await loadDirectory(trashPath);
    };
    btnHome.onclick = async () => {
        searchBar.value = '';
        await loadDirectory('~');
    };
    btnHotkeys.onclick = () => {
        modal.style.display = 'flex';
    };
    btnCloseModal.onclick = () => {
        modal.style.display = 'none';
    };
    modal.onclick = (e) => {
        if (e.target === modal) modal.style.display = 'none';
    };
    btnQuit.onclick = async () => {
        await Quit();
    };
}

function setupSearch() {
    searchBar.addEventListener('input', async () => {
        const query = searchBar.value;
        if (query.startsWith('/') || query.startsWith('~')) {
            if (query.endsWith('/')) {
                await loadDirectory(query);
            }
            return;
        }

        if (query.trim() === '') {
            files = [...allFiles];
        } else {
            const lowerQuery = query.toLowerCase();
            files = allFiles.filter(f => f.name.toLowerCase().includes(lowerQuery));
        }
        selectedIndex = 0;
        renderFileList();
        updateSelection(true);
    });
}

async function loadDirectory(path: string, preserveIndex: boolean = false) {
    try {
        const oldIndex = selectedIndex;
        allFiles = await ListFiles(path);
        files = [...allFiles];
        
        if (allFiles.length > 0) {
            if (allFiles[0].name === '../' && allFiles.length > 1) {
                currentPath = allFiles[1].path.substring(0, allFiles[1].path.lastIndexOf('/'));
            } else if (allFiles.length > 0 && allFiles[0].name !== '../') {
                currentPath = allFiles[0].path.substring(0, allFiles[0].path.lastIndexOf('/'));
            } else {
                currentPath = path;
            }
            currentPathEl.textContent = currentPath;
        }

        if (preserveIndex && searchBar.value === '') {
            selectedIndex = Math.min(oldIndex, Math.max(0, files.length - 1));
        } else {
            selectedIndex = 0;
        }
        
        renderFileList();
        updateSelection(true); 
    } catch (e) {
        console.error(e);
        previewContentEl.innerHTML = `<div class="empty-state"><p>Error loading directory</p></div>`;
    }
}

function renderFileList() {
    fileListEl.innerHTML = '';
    files.forEach((file, index) => {
        const li = document.createElement('li');
        li.className = `file-item`;
        li.id = `item-${index}`;
        
        if (file.name === '../') {
            li.innerHTML = `
                <div class="file-info">
                    <div class="file-name">
                        <span class="badge badge-dir">&larr;</span>
                        <span style="font-weight: 600; color: var(--accent);">Parent Directory</span>
                    </div>
                    <span class="file-meta-small">Go Back</span>
                </div>
            `;
        } else {
            let badgeClass = 'badge-none';
            let badgeText = '---';
            if (file.isDir) { badgeClass = 'badge-dir'; badgeText = 'DIR'; }
            else if (file.previewType === 'image') { badgeClass = 'badge-img'; badgeText = 'IMG'; }
            else if (file.previewType === 'video') { badgeClass = 'badge-vid'; badgeText = 'VID'; }
            else if (file.previewType === 'pdf') { badgeClass = 'badge-doc'; badgeText = 'PDF'; }
            else if (file.previewType === 'text') { badgeClass = 'badge-txt'; badgeText = 'TXT'; }
            else if (file.previewType === 'document') { badgeClass = 'badge-doc'; badgeText = 'DOC'; }

            const isPinned = Object.values(quickTargets).includes(file.path);
            let pinBtn = '';
            if (file.isDir) {
                const pinnedClass = isPinned ? 'pinned' : '';
                pinBtn = `<button class="action-btn pin-btn ${pinnedClass}" title="Toggle Pin to Quick Targets">${isPinned ? 'Pinned' : 'Pin'}</button>`;
            }

            li.innerHTML = `
                <div class="file-info" style="flex: 1;">
                    <div class="file-name">
                        <span class="badge ${badgeClass}">${badgeText}</span>
                        <span>${file.name}</span>
                    </div>
                    <span class="file-meta-small">${file.isDir ? 'Folder' : file.sizeMB.toFixed(2) + ' MB'} | ${file.modTime}</span>
                </div>
                ${pinBtn}
            `;
            
            const btnEl = li.querySelector('.pin-btn') as HTMLButtonElement;
            if (btnEl) {
                btnEl.onclick = async (e) => {
                    e.stopPropagation();
                    quickTargets = await PinTarget(file.path);
                    renderQuickTargets();
                    renderFileList(); // Re-render to update pin state visually
                    updateSelection(true);
                };
            }
        }

        li.onclick = () => {
            selectedIndex = index;
            updateSelection(true);
        };
        li.ondblclick = () => handleAction();
        fileListEl.appendChild(li);
    });
}

function updateSelection(loadPreview: boolean = false) {
    const oldSelected = fileListEl.querySelector('.selected');
    if (oldSelected) oldSelected.classList.remove('selected');

    const newSelected = document.getElementById(`item-${selectedIndex}`);
    if (newSelected) {
        newSelected.classList.add('selected');
        newSelected.scrollIntoView({ block: 'nearest' });
    }

    if (loadPreview) {
        if (previewDebounceTimer) {
            clearTimeout(previewDebounceTimer);
        }
        previewDebounceTimer = window.setTimeout(async () => {
            await renderPreview();
        }, 150);
    }
}

async function renderPreview() {
    if (files.length === 0) {
        previewTitleEl.textContent = "No matches";
        fileMetaEl.innerHTML = "";
        previewContentEl.innerHTML = `<div class="empty-state"><div class="empty-state-icon">Ø</div><p>Empty</p></div>`;
        return;
    }

    const file = files[selectedIndex];
    previewTitleEl.textContent = file.name;
    
    if (file.name === '../') {
        fileMetaEl.innerHTML = ``;
        previewContentEl.innerHTML = `<div class="empty-state"><div class="empty-state-icon">↑</div><p>Parent Directory</p></div>`;
        return;
    }
    
    fileMetaEl.innerHTML = `
        <div class="metadata-grid">
            <div class="meta-item">
                <span class="meta-label">Type</span>
                <span class="meta-value">${file.isDir ? 'Directory' : 'File'}</span>
            </div>
            <div class="meta-item">
                <span class="meta-label">Extension</span>
                <span class="meta-value">${file.ext || 'None'}</span>
            </div>
            <div class="meta-item">
                <span class="meta-label">Size</span>
                <span class="meta-value">${file.sizeMB.toFixed(2)} MB</span>
            </div>
            <div class="meta-item">
                <span class="meta-label">Hidden</span>
                <span class="meta-value">${file.isHidden ? 'Yes' : 'No'}</span>
            </div>
            <div class="meta-item">
                <span class="meta-label">Modified</span>
                <span class="meta-value">${file.modTime}</span>
            </div>
            <div class="meta-item">
                <span class="meta-label">Perms</span>
                <span class="meta-value">${file.perms}</span>
            </div>
        </div>
    `;

    if (file.isDir) {
        previewContentEl.innerHTML = `<div class="empty-state"><div class="empty-state-icon">📁</div><p>Folder</p></div>`;
        return;
    }

    const localUrl = `/local/${file.path}`;

    switch (file.previewType) {
        case 'image':
            previewContentEl.innerHTML = `<img src="${localUrl}" class="preview-img">`;
            break;
        case 'video':
            previewContentEl.innerHTML = `
                <div class="preview-video-container">
                    <video src="${localUrl}" class="preview-video" controls autoplay loop muted></video>
                    <button id="btn-native-video" class="btn-native-player">Open in System Player</button>
                </div>
            `;
            setTimeout(() => {
                const btnNative = document.getElementById('btn-native-video');
                if (btnNative) {
                    btnNative.onclick = () => OpenNative(file.path);
                }
            }, 0);
            break;
        case 'pdf':
            previewContentEl.innerHTML = `<iframe src="${localUrl}" class="preview-pdf"></iframe>`;
            break;
        case 'text':
        case 'document':
            previewContentEl.innerHTML = `<div class="empty-state"><p>Loading document text...</p></div>`;
            try {
                const preview = await GetFilePreview(file.path);
                const safeText = preview.text.replace(/</g, "&lt;").replace(/>/g, "&gt;");
                previewContentEl.innerHTML = `<div class="preview-text-container"><pre class="preview-text">${safeText}</pre></div>`;
            } catch (e) {
                previewContentEl.innerHTML = `<div class="empty-state"><p>Error reading file.</p></div>`;
            }
            break;
        default:
            previewContentEl.innerHTML = `<div class="empty-state"><p>No preview available</p></div>`;
            break;
    }
}

async function handleAction() {
    if (files.length === 0) return;
    const file = files[selectedIndex];
    
    if (file.isDir || file.name === '../') {
        searchBar.value = '';
        await loadDirectory(file.path);
    } else {
        await OpenNative(file.path);
    }
}

async function handleMove(targetKey: string) {
    const targetDir = quickTargets[targetKey];
    if (!targetDir) return;
    
    if (files.length === 0) return;
    const file = files[selectedIndex];
    if (file.name === '../') return;

    await MoveFile(file.path, targetDir);
    await loadDirectory(currentPath, true);
}

async function handleTrash() {
    if (files.length === 0) return;
    const file = files[selectedIndex];
    if (file.name === '../') return;

    await TrashFile(file.path);
    await loadDirectory(currentPath, true);
}

function setupKeyboardListeners() {
    window.addEventListener('keydown', async (e) => {
        if ((e.ctrlKey || e.metaKey) && (e.key === 'f' || e.key === 'F')) {
            e.preventDefault();
            searchBar.focus();
            return;
        }

        if (document.activeElement === searchBar) {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter') {
                e.preventDefault();
            } else {
                return;
            }
        }

        if (files.length === 0) return;

        switch (e.key) {
            case 'ArrowDown':
                e.preventDefault();
                if (selectedIndex < files.length - 1) {
                    selectedIndex++;
                    updateSelection(true);
                }
                break;
            case 'ArrowUp':
                e.preventDefault();
                if (selectedIndex > 0) {
                    selectedIndex--;
                    updateSelection(true);
                }
                break;
            case 'Enter':
                e.preventDefault();
                await handleAction();
                break;
            case 'r':
            case 'R':
                e.preventDefault();
                await handleTrash();
                break;
            case 'Escape':
                e.preventDefault();
                searchBar.blur();
                if (modal.style.display !== 'none') {
                    modal.style.display = 'none';
                }
                break;
            default:
                if (e.key >= '1' && e.key <= '9') {
                    e.preventDefault();
                    await handleMove(e.key);
                }
                break;
        }
    });
}

document.addEventListener("DOMContentLoaded", () => {
    init();
});
