import './style.css';
import * as Sentry from '@sentry/browser';
// @ts-ignore
import { ListFiles, GetQuickTargets, TrashFile, MoveFile, GetFilePreview, Quit, PickDirectory, OpenNative, GetTrashPath, PinTarget, CheckForUpdates, FindDuplicates, GetMediaServerURL, EmptyTrash } from '../wailsjs/go/gui/Controller';
import { getFileIcon } from './icons';

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
let isTriageMultiSelectMode = false;
let triageSelectedIndices = new Set<number>();
let isDragging = false;
let dragTargetValue = true;
let triageHistory: string[] = [];
let triageHistoryIndex: number = -1;
let quickTargets: Record<string, string> = {};
let previewDebounceTimer: number | null = null;
let isPreviewMinimized = false;
let isXRayMode = false;

const fileListEl = document.getElementById('file-list') as HTMLUListElement;
const currentPathEl = document.getElementById('current-path') as HTMLDivElement;
const previewTitleEl = document.getElementById('preview-title') as HTMLHeadingElement;
const fileMetaEl = document.getElementById('file-meta') as HTMLDivElement;
const previewContentEl = document.getElementById('preview-content') as HTMLDivElement;

const searchBar = document.getElementById('search-bar') as HTMLInputElement;
const btnOpen = document.getElementById('btn-open') as HTMLButtonElement;
const btnTrash = document.getElementById('btn-trash') as HTMLButtonElement;
const btnTrashPortal = document.getElementById('btn-trash-portal') as HTMLButtonElement;
const btnTrashPortalDupes = document.getElementById('btn-trash-portal-dupes') as HTMLButtonElement;
const btnEmptyTrash = document.getElementById('btn-empty-trash') as HTMLButtonElement;
const btnTriageMultiselect = document.getElementById('btn-triage-multiselect') as HTMLButtonElement;
const btnTriageSelectAll = document.getElementById('btn-triage-select-all') as HTMLButtonElement;
const btnHistoryBack = document.getElementById('btn-history-back') as HTMLButtonElement;
const btnHistoryForward = document.getElementById('btn-history-forward') as HTMLButtonElement;
const btnHotkeys = document.getElementById('btn-hotkeys') as HTMLButtonElement;
const btnXray = document.getElementById('btn-xray') as HTMLButtonElement;
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
    // 1. Welcome Screen
    if (!localStorage.getItem('sift_welcome_seen')) {
        const welcomeModal = document.getElementById('welcome-modal');
        if (welcomeModal) {
            welcomeModal.style.display = 'flex';
            document.getElementById('btn-welcome-start')!.onclick = () => {
                welcomeModal.style.display = 'none';
                localStorage.setItem('sift_welcome_seen', 'true');
            };
        }
    }

    // 2. Routing Setup
    setupRouting();

    // 3. Dupes Page Setup
    setupDupes();

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
            } e

            renderQuickTargets();
            if (document.getElementById('tab-triage')?.classList.contains('active')) {
                renderFileList();
                updateSelection(true);
            }
        };
        wrapper.appendChild(btn);
        wrapper.appendChild(unpinBtn);
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
    btnTrashPortalDupes.onclick = async () => {
        const tabTriage = document.getElementById('tab-triage');
        if (tabTriage) tabTriage.click();
        const trashPath = await GetTrashPath();
        searchBar.value = '';
        await loadDirectory(trashPath);
    };
    btnEmptyTrash.onclick = async () => {
        if (window.confirm("Are you sure you want to permanently delete all items in the Recycle Bin?")) {
            try {
                await EmptyTrash();
                await loadDirectory(currentPath); // Refresh
            } catch (err) {
                console.error("Failed to empty trash", err);
            }
        }
    };
    btnTriageMultiselect.onclick = () => {
        isTriageMultiSelectMode = !isTriageMultiSelectMode;
        if (!isTriageMultiSelectMode) {
            triageSelectedIndices.clear();
            btnTriageSelectAll.style.display = 'none';
            btnTriageMultiselect.classList.remove('active');
        } else {
            btnTriageSelectAll.style.display = 'inline-block';
            btnTriageMultiselect.classList.add('active');
        }
        renderFileList();
        updateSelection(true);
    };
    btnTriageSelectAll.onclick = () => {
        if (triageSelectedIndices.size === files.length) {
            triageSelectedIndices.clear();
        } else {
            files.forEach((_, i) => triageSelectedIndices.add(i));
        }
        renderFileList();
        updateSelection(true);
    };
    
    btnHistoryBack.onclick = () => {
        if (triageHistoryIndex > 0) {
            triageHistoryIndex--;
            loadDirectory(triageHistory[triageHistoryIndex], false, true);
        }
    };

    btnHistoryForward.onclick = () => {
        if (triageHistoryIndex < triageHistory.length - 1) {
            triageHistoryIndex++;
            loadDirectory(triageHistory[triageHistoryIndex], false, true);
        }
    };


    btnHotkeys.onclick = () => {
        const triageHotkeys = document.getElementById('hotkeys-triage');
        const dupesHotkeys = document.getElementById('hotkeys-dupes');
        if (document.getElementById('tab-dupes')?.classList.contains('active')) {
            if (triageHotkeys) triageHotkeys.style.display = 'none';
            if (dupesHotkeys) dupesHotkeys.style.display = 'block';
        } else {
            if (triageHotkeys) triageHotkeys.style.display = 'block';
            if (dupesHotkeys) dupesHotkeys.style.display = 'none';
        }
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

function setupRouting() {
    const tabTriage = document.getElementById('tab-triage')!;
    const tabStaging = document.getElementById('tab-staging')!;
    const tabDupes = document.getElementById('tab-dupes')!;
    const pageTriage = document.getElementById('page-triage')!;
    const pageStaging = document.getElementById('page-staging')!;
    const pageDupes = document.getElementById('page-dupes')!;

    const switchTab = (tab: string) => {
        [tabTriage, tabStaging, tabDupes].forEach(t => t.classList.remove('active'));
        [pageTriage, pageStaging, pageDupes].forEach(p => p.style.display = 'none');

        if (tab === 'triage') {
            tabTriage.classList.add('active');
            pageTriage.style.display = 'flex';
            searchBar.focus();
        } else if (tab === 'staging') {
            tabStaging.classList.add('active');
            pageStaging.style.display = 'flex';
        } else if (tab === 'dupes') {
            tabDupes.classList.add('active');
            pageDupes.style.display = 'flex';
        }
    };

    tabTriage.onclick = () => switchTab('triage');
    tabStaging.onclick = () => switchTab('staging');
    tabDupes.onclick = () => switchTab('dupes');

    // Setup Maximize/Minimize Toggle
    const btnTogglePreview = document.getElementById('btn-toggle-preview') as HTMLButtonElement;
    const iconPreviewToggle = document.getElementById('icon-preview-toggle') as unknown as SVGElement;
    
    if (btnTogglePreview) {
        btnTogglePreview.onclick = () => {
            isPreviewMinimized = !isPreviewMinimized;
            if (!isPreviewMinimized) isXRayMode = false;

            if (isPreviewMinimized) {
                pageTriage.classList.add('preview-minimized');
                // Maximize Icon (corners pointing out)
                iconPreviewToggle.innerHTML = `<path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"></path>`;
                btnTogglePreview.title = "Maximize Preview";
            } else {
                pageTriage.classList.remove('preview-minimized');
                // Minimize Icon (corners pointing in)
                iconPreviewToggle.innerHTML = `<path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3"></path>`;
                btnTogglePreview.title = "Minimize Preview";
            }
            renderMiddlePane();
        };
    }

    if (btnXray) {
        btnXray.onclick = () => {
            isXRayMode = true;
            if (!isPreviewMinimized) {
                isPreviewMinimized = true;
                pageTriage.classList.add('preview-minimized');
                iconPreviewToggle.innerHTML = `<path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"></path>`;
                btnTogglePreview.title = "Maximize Preview";
            }
            renderMiddlePane();
        };
    }

    // Make switchTab available globally for hotkeys
    (window as any).switchTab = switchTab;
}

let scanDirs: string[] = [];
let dupeResults: any[] = [];
let selectedDupeIndices: Set<number> = new Set([0]);
let lastSelectedDupeIndex = 0;

function setupDupes() {
    const btnAddDir = document.getElementById('btn-add-dir')!;
    const btnScan = document.getElementById('btn-scan-dupes')!;
    const scanDirsList = document.getElementById('scan-dirs-list')!;
    const btnDupeOpen = document.getElementById('btn-dupe-open')!;
    const btnDupeTrash = document.getElementById('btn-dupe-trash')!;

    const inputAddDir = document.getElementById('input-add-dir') as HTMLInputElement;

    btnAddDir.onclick = async () => {
        let dir = inputAddDir.value.trim();
        if (!dir) {
            dir = await PickDirectory();
        }
        if (dir && !scanDirs.includes(dir)) {
            scanDirs.push(dir);
            inputAddDir.value = '';
            renderScanDirs();
        }
    };

    btnScan.onclick = async () => {
        if (scanDirs.length === 0) return;
        btnScan.innerHTML = "Scanning... (this may take a while)";
        btnScan.style.opacity = "0.7";
        btnScan.style.pointerEvents = "none";

        try {
            dupeResults = await FindDuplicates(scanDirs) || [];
            selectedDupeIndices.clear();
            lastSelectedDupeIndex = 0;

            const btnAutoOldest = document.getElementById('btn-auto-oldest');
            const btnAutoNewest = document.getElementById('btn-auto-newest');
            if (btnAutoOldest && btnAutoOldest.classList.contains('active')) {
                let globalIdx = 0;
                dupeResults.forEach(group => {
                    if (group.files.length > 1) {
                        selectedDupeIndices.add(globalIdx); // Oldest file is sorted first by the backend
                    }
                    globalIdx += group.files.length;
                });
            } else if (btnAutoNewest && btnAutoNewest.classList.contains('active')) {
                let globalIdx = 0;
                dupeResults.forEach(group => {
                    if (group.files.length > 1) {
                        selectedDupeIndices.add(globalIdx + group.files.length - 1); // Newest file is sorted last by the backend
                    }
                    globalIdx += group.files.length;
                });
            } else {
                selectedDupeIndices.add(0);
            }

            renderDupeResults();
            updateDupeSelection();
        } catch (e) {
            console.error("Scan failed", e);
        }

        btnScan.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg> Start Scan`;
        btnScan.style.opacity = "1";
        btnScan.style.pointerEvents = "auto";
    };

    // Auto-Select Segmented Control
    const btnAutoNone = document.getElementById('btn-auto-none')!;
    const btnAutoOldest = document.getElementById('btn-auto-oldest')!;
    const btnAutoNewest = document.getElementById('btn-auto-newest')!;

    btnAutoNone.onclick = () => {
        btnAutoNone.classList.add('active');
        btnAutoOldest.classList.remove('active');
        btnAutoNewest.classList.remove('active');
        selectedDupeIndices.clear();
        updateDupeSelection();
    };

    btnAutoOldest.onclick = () => {
        btnAutoOldest.classList.add('active');
        btnAutoNone.classList.remove('active');
        btnAutoNewest.classList.remove('active');

        selectedDupeIndices.clear();
        let globalIdx = 0;
        dupeResults.forEach(group => {
            if (group.files.length > 1) {
                selectedDupeIndices.add(globalIdx); // oldest file is first in array
            }
            globalIdx += group.files.length;
        });

        updateDupeSelection();
    };

    btnAutoNewest.onclick = () => {
        btnAutoNewest.classList.add('active');
        btnAutoNone.classList.remove('active');
        btnAutoOldest.classList.remove('active');

        selectedDupeIndices.clear();
        let globalIdx = 0;
        dupeResults.forEach(group => {
            if (group.files.length > 1) {
                selectedDupeIndices.add(globalIdx + group.files.length - 1); // newest file is last in array
            }
            globalIdx += group.files.length;
        });

        updateDupeSelection();
    };

    const renderScanDirs = () => {
        scanDirsList.innerHTML = '';
        scanDirs.forEach((dir, i) => {
            const li = document.createElement('li');
            li.className = 'file-item';
            li.innerHTML = `
                <div class="file-info">
                    <div class="file-name">
                        <span class="file-icon" style="display: flex; align-items: center; justify-content: center; width: 20px; height: 20px; flex-shrink: 0; color: inherit; margin-right: 8px;">
                            ${getFileIcon(true, '', 'folder')}
                        </span> 
                        <span>${dir}</span>
                    </div>
                </div>
                <button class="action-btn danger" style="padding: 2px 6px;">&times;</button>
            `;
            li.querySelector('button')!.onclick = () => {
                scanDirs.splice(i, 1);
                renderScanDirs();
            };
            scanDirsList.appendChild(li);
        });
    };

    btnDupeOpen.onclick = async () => {
        const item = getSelectedDupeItem();
        if (item) await OpenNative(item);
    };

    btnDupeTrash.onclick = async () => {
        const items = getSelectedDupeItems();
        if (items.length > 0) {
            for (const idx of selectedDupeIndices) {
                const el = document.getElementById(`dupe-item-${idx}`);
                if (el) {
                    el.classList.add('slide-out');
                }
            }
            await new Promise(r => setTimeout(r, 150));

            // Sort indices descending to remove from array safely
            const sortedIndices = Array.from(selectedDupeIndices).sort((a, b) => b - a);
            for (let i = 0; i < items.length; i++) {
                await TrashFile(items[i]);
                removeDupeItem(sortedIndices[i]);
            }

            selectedDupeIndices = new Set([0]);
            lastSelectedDupeIndex = 0;
            renderDupeResults();
            updateDupeSelection();
        }
    };
}

function getSelectedDupeItem(): string | null {
    const items = getSelectedDupeItems();
    return items.length > 0 ? items[items.length - 1] : null;
}

function getSelectedDupeItems(): string[] {
    const items: string[] = [];
    let currentIdx = 0;
    for (const group of dupeResults) {
        for (const file of group.files) {
            if (selectedDupeIndices.has(currentIdx)) {
                items.push(file);
            }
            currentIdx++;
        }
    }
    return items;
}

function removeDupeItem(globalIndex: number) {
    let currentIdx = 0;
    for (let i = 0; i < dupeResults.length; i++) {
        const group = dupeResults[i];
        for (let j = 0; j < group.files.length; j++) {
            if (currentIdx === globalIndex) {
                group.files.splice(j, 1);
                if (group.files.length <= 1) {
                    // Group no longer has duplicates
                    dupeResults.splice(i, 1);
                }
                return;
            }
            currentIdx++;
        }
    }
}

function renderDupeResults() {
    const list = document.getElementById('dupes-results-list')!;
    list.innerHTML = '';

    if (dupeResults.length === 0) {
        list.innerHTML = `<div style="padding: 16px; text-align: center; color: var(--text-secondary);">No duplicates found! 🎉</div>`;
        document.getElementById('dupe-preview-content')!.innerHTML = `<div class="empty-state"><div class="empty-state-icon">Ø</div><p>No duplicates</p></div>`;
        document.getElementById('dupe-title')!.textContent = "No duplicates";
        document.getElementById('dupe-file-meta')!.innerHTML = "";
        return;
    }

    let globalIndex = 0;
    dupeResults.forEach((group, groupIndex) => {
        const card = document.createElement('div');
        card.className = 'dupe-card';
        card.id = `dupe-card-${groupIndex}`;

        const groupHeader = document.createElement('div');
        groupHeader.className = 'dupe-group-header';
        const sizeMB = (group.size / (1024 * 1024)).toFixed(2);
        groupHeader.textContent = `Group ${groupIndex + 1} • ${sizeMB} MB • Hash: ${group.hash.substring(0, 8)}...`;
        card.appendChild(groupHeader);

        const fileList = document.createElement('ul');
        fileList.className = 'file-list';
        fileList.style.padding = '4px';
        fileList.style.margin = '0';

        group.files.forEach((file: string) => {
            const li = document.createElement('li');
            li.className = 'file-item';
            li.id = `dupe-item-${globalIndex}`;
            li.setAttribute('data-group-index', groupIndex.toString());
            const filename = file.split(/[\/\\]/).pop() || '';
            const ext = '.' + (filename.split('.').pop() || '');
            li.innerHTML = `
                <div class="file-info">
                    <div class="file-name">
                        <span class="file-icon" style="display: flex; align-items: center; justify-content: center; width: 20px; height: 20px; flex-shrink: 0; color: inherit; margin-right: 8px;">
                            ${getFileIcon(false, ext, '')}
                        </span>
                        <span>${filename}</span>
                    </div>
                    <span class="file-meta-small">${file}</span>
                </div>
            `;
            const idx = globalIndex;
            li.onclick = (e) => {
                if (e.shiftKey) {
                    const start = Math.min(lastSelectedDupeIndex, idx);
                    const end = Math.max(lastSelectedDupeIndex, idx);
                    if (!e.ctrlKey) selectedDupeIndices.clear();
                    for (let i = start; i <= end; i++) {
                        selectedDupeIndices.add(i);
                    }
                } else if (e.ctrlKey) {
                    if (selectedDupeIndices.has(idx)) {
                        selectedDupeIndices.delete(idx);
                    } else {
                        selectedDupeIndices.add(idx);
                    }
                    lastSelectedDupeIndex = idx;
                } else {
                    selectedDupeIndices = new Set([idx]);
                    lastSelectedDupeIndex = idx;
                }
                updateDupeSelection();
            };
            fileList.appendChild(li);
            globalIndex++;
        });
        card.appendChild(fileList);
        list.appendChild(card);
    });
}

function updateDupeSelection() {
    const list = document.getElementById('dupes-results-list')!;
    const oldSelected = list.querySelectorAll('.selected');
    oldSelected.forEach(el => el.classList.remove('selected'));

    const oldActiveCards = list.querySelectorAll('.dupe-card.active');
    oldActiveCards.forEach(el => el.classList.remove('active'));

    const oldActivePreviews = list.querySelectorAll('.active-preview');
    oldActivePreviews.forEach(el => el.classList.remove('active-preview'));

    selectedDupeIndices.forEach(idx => {
        const newSelected = document.getElementById(`dupe-item-${idx}`);
        if (newSelected) {
            newSelected.classList.add('selected');
        }
    });

    const latestSelected = document.getElementById(`dupe-item-${lastSelectedDupeIndex}`);
    if (latestSelected) {
        latestSelected.classList.add('active-preview');
        latestSelected.scrollIntoView({ block: 'nearest' });
        const groupIndex = latestSelected.getAttribute('data-group-index');
        if (groupIndex !== null) {
            const activeCard = document.getElementById(`dupe-card-${groupIndex}`);
            if (activeCard) activeCard.classList.add('active');
        }
    }

    const file = getSelectedDupeItem();
    if (file) {
        document.getElementById('dupe-preview-title')!.textContent = file.split('/').pop() || file.split('\\').pop() || '';
        document.getElementById('dupe-file-meta')!.innerHTML = `<div class="meta-item"><span class="meta-label">Path</span><span class="meta-value" style="font-size: 0.7rem;">${file}</span></div>`;

        const ext = file.split('.').pop()?.toLowerCase() || '';
        const imgExts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'ico'];
        const vidExts = ['mp4', 'webm', 'ogg', 'mov', 'mkv', 'avi'];
        const pdfExts = ['pdf'];

        if (imgExts.includes(ext) || vidExts.includes(ext) || pdfExts.includes(ext)) {
            document.getElementById('dupe-preview-content')!.innerHTML = `<div style="padding: 16px; color: var(--text-secondary); text-align: center;">Loading media...</div>`;

            GetMediaServerURL().then(serverUrl => {
                const currentFile = getSelectedDupeItem();
                if (currentFile !== file) return;

                const mediaUrl = `${serverUrl}/video-preview?path=${encodeURIComponent(file)}`;

                if (imgExts.includes(ext)) {
                    document.getElementById('dupe-preview-content')!.innerHTML = `<img src="${mediaUrl}" class="preview-img">`;
                } else if (vidExts.includes(ext)) {
                    const container = document.getElementById('dupe-preview-content')!;
                    container.innerHTML = `<div class="preview-video-container" id="dupe-video-container"></div>`;
                    const videoEl = document.createElement('video');
                    videoEl.src = mediaUrl;
                    videoEl.className = 'preview-video';
                    videoEl.controls = true;
                    videoEl.autoplay = true;
                    videoEl.loop = true;
                    videoEl.setAttribute('muted', 'true');
                    videoEl.setAttribute('playsinline', 'true');
                    videoEl.muted = true;
                    document.getElementById('dupe-video-container')!.appendChild(videoEl);
                } else if (pdfExts.includes(ext)) {
                    document.getElementById('dupe-preview-content')!.innerHTML = `<embed src="${mediaUrl}" type="application/pdf" class="preview-pdf" style="width: 100%; height: 100%; border: none;"></embed>`;
                }
            }).catch(err => {
                const currentFile = getSelectedDupeItem();
                if (currentFile !== file) return;
                document.getElementById('dupe-preview-content')!.innerHTML = `<div class="empty-state"><div class="empty-state-icon">!</div><p>Failed to load media</p><p style="font-size:0.75rem; color:var(--danger)">${err}</p></div>`;
            });
        } else {
            document.getElementById('dupe-preview-content')!.innerHTML = `<div style="padding: 16px; color: var(--text-secondary); text-align: center;">Loading preview...</div>`;

            GetFilePreview(file).then(previewData => {
                const currentFile = getSelectedDupeItem();
                if (currentFile !== file) return;

                if (previewData && previewData.text) {
                    const safeText = previewData.text.replace(/</g, "&lt;").replace(/>/g, "&gt;");
                    let html = `<pre style="padding: 16px; font-size: 0.8rem; overflow: auto; height: 100%; font-family: var(--font-mono); color: var(--text-main); line-height: 1.4; white-space: pre-wrap;">${safeText}</pre>`;
                    document.getElementById('dupe-preview-content')!.innerHTML = html;
                } else {
                    document.getElementById('dupe-preview-content')!.innerHTML = `<div class="empty-state"><div class="empty-state-icon">📄</div><p>Identical Content Match</p><p style="font-size:0.75rem; opacity:0.7;">No text preview available</p></div>`;
                }
            });
        }
    }
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

function updateHistoryButtons() {
    btnHistoryBack.disabled = triageHistoryIndex <= 0;
    btnHistoryForward.disabled = triageHistoryIndex >= triageHistory.length - 1;
}

function renderBreadcrumbs(path: string) {
    const parts = path.split(/[\/\\]/).filter(p => p);
    currentPathEl.innerHTML = '';
    currentPathEl.style.overflowX = 'auto';
    currentPathEl.style.flexWrap = 'nowrap';
    
    const elements: HTMLElement[] = [];
    let currentAccPath = '';

    if (path.startsWith('/')) {
        currentAccPath = '/';
        const rootEl = document.createElement('span');
        rootEl.className = 'breadcrumb-item';
        rootEl.textContent = '/';
        rootEl.onclick = () => loadDirectory('/');
        elements.push(rootEl);
    } else if (path.match(/^[a-zA-Z]:/)) {
        currentAccPath = parts[0] + '\\';
        const rootEl = document.createElement('span');
        rootEl.className = 'breadcrumb-item';
        rootEl.textContent = parts[0];
        rootEl.onclick = () => loadDirectory(currentAccPath);
        elements.push(rootEl);
        parts.shift();
    }

    parts.forEach((part, i) => {
        if (i > 0 || elements.length > 0) {
            const sep = document.createElement('span');
            sep.className = 'breadcrumb-separator';
            sep.textContent = '>';
            elements.push(sep);
        }
        
        currentAccPath += (currentAccPath.endsWith('/') || currentAccPath.endsWith('\\') || currentAccPath === '' ? '' : (path.match(/^[a-zA-Z]:/) ? '\\' : '/')) + part;
        const p = currentAccPath; // closure
        
        const span = document.createElement('span');
        span.className = 'breadcrumb-item';
        span.textContent = part;
        span.onclick = () => loadDirectory(p);
        elements.push(span);
    });

    elements.forEach(el => currentPathEl.appendChild(el));
}

async function loadDirectory(path: string, preserveIndex: boolean = false, skipHistory: boolean = false) {
    try {
        const oldIndex = selectedIndex;
        let rawFiles = await ListFiles(path);
        
        // Ensure path resolves fully
        if (rawFiles.length > 0) {
            currentPath = path;
            if (rawFiles[0].name === '../' && rawFiles.length > 1) {
                currentPath = rawFiles[1].path.substring(0, rawFiles[1].path.lastIndexOf('/'));
            } else if (rawFiles.length > 0 && rawFiles[0].name !== '../') {
                currentPath = rawFiles[0].path.substring(0, rawFiles[0].path.lastIndexOf('/'));
            }
        } else {
            currentPath = path;
        }

        allFiles = rawFiles.filter(f => f.name !== '../');
        files = [...allFiles];

        if (!skipHistory) {
            triageHistory.splice(triageHistoryIndex + 1);
            triageHistory.push(currentPath);
            triageHistoryIndex = triageHistory.length - 1;
        }
        updateHistoryButtons();
        renderBreadcrumbs(currentPath);

        if (preserveIndex && searchBar.value === '') {
            selectedIndex = Math.min(oldIndex, Math.max(0, files.length - 1));
        } else {
            selectedIndex = 0;
        }

        const trashPath = await GetTrashPath();
        if (path === trashPath) {
            btnEmptyTrash.style.display = 'inline-block';
        } else {
            btnEmptyTrash.style.display = 'none';
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

        const svgIcon = getFileIcon(file.isDir, file.ext, file.previewType);

        const isPinned = Object.values(quickTargets).includes(file.path);
        let pinBtn = '';
        if (file.isDir) {
            const pinnedClass = isPinned ? 'pinned' : '';
            pinBtn = `<button class="action-btn pin-btn ${pinnedClass}" title="Toggle Pin to Quick Targets">${isPinned ? 'Pinned' : 'Pin'}</button>`;
        }

        let checkboxHtml = '';
        if (isTriageMultiSelectMode) {
            const isChecked = triageSelectedIndices.has(index) ? 'checked' : '';
            checkboxHtml = `<input type="checkbox" class="triage-checkbox" ${isChecked} tabindex="-1">`;
        }

        li.innerHTML = `
            ${checkboxHtml}
            <div class="file-info" style="flex: 1;">
                <div style="display: flex; align-items: center;">
                    <span class="file-icon" style="display: flex; align-items: center; justify-content: center; width: 20px; height: 20px; flex-shrink: 0; color: inherit; margin-right: 8px;">
                        ${svgIcon}
                    </span>
                    <div style="display: flex; flex-direction: column; justify-content: center;">
                        <span style="font-weight: 500;">${file.name}</span>
                        <span class="file-meta-small">${file.isDir ? 'Folder' : file.sizeMB.toFixed(2) + ' MB'} | ${file.modTime}</span>
                    </div>
                </div>
            </div>
            ${pinBtn}
        `;

        const btnEl = li.querySelector('.pin-btn') as HTMLButtonElement;
        if (btnEl) {
            btnEl.onmousedown = (e) => e.stopPropagation();
            btnEl.onclick = async (e) => {
                e.stopPropagation();
                quickTargets = await PinTarget(file.path);
                renderQuickTargets();
                renderFileList();
                updateSelection(true);
            };
        }

        li.onmousedown = (e) => {
            if (e.button !== 0) return; // Only left click
            if (isTriageMultiSelectMode) {
                isDragging = true;
                if (triageSelectedIndices.has(index)) {
                    triageSelectedIndices.delete(index);
                    dragTargetValue = false;
                } else {
                    triageSelectedIndices.add(index);
                    dragTargetValue = true;
                }
            }
            selectedIndex = index;
            updateSelection(true);
        };
        
        li.onmouseenter = () => {
            if (isTriageMultiSelectMode && isDragging) {
                if (dragTargetValue) {
                    triageSelectedIndices.add(index);
                } else {
                    triageSelectedIndices.delete(index);
                }
                const cb = li.querySelector('.triage-checkbox') as HTMLInputElement;
                if (cb) cb.checked = dragTargetValue;
                updateSelection(false);
            }
        };

        li.ondblclick = () => handleAction();
        fileListEl.appendChild(li);
    });
}

function updateSelection(loadPreview: boolean = false) {
    // Clear old visual selection styles
    const oldSelected = fileListEl.querySelectorAll('.selected, .active-preview, .multi-selected');
    oldSelected.forEach(el => {
        el.classList.remove('selected', 'active-preview', 'multi-selected');
    });

    if (isTriageMultiSelectMode) {
        triageSelectedIndices.forEach(idx => {
            const el = document.getElementById(`item-${idx}`);
            if (el) {
                el.classList.add('multi-selected');
                const cb = el.querySelector('.triage-checkbox') as HTMLInputElement;
                if (cb) cb.checked = true;
            }
        });
    }

    const newSelected = document.getElementById(`item-${selectedIndex}`);
    if (newSelected) {
        if (!isTriageMultiSelectMode) {
            newSelected.classList.add('selected');
        }
        newSelected.classList.add('active-preview');
        newSelected.scrollIntoView({ block: 'nearest' });
    }

    if (files[selectedIndex]) {
        const isDir = files[selectedIndex].isDir;
        if (isDir) {
            btnXray.style.opacity = '1';
            btnXray.style.pointerEvents = 'auto';
        } else {
            btnXray.style.opacity = '0.5';
            btnXray.style.pointerEvents = 'none';
        }
    }

    if (isPreviewMinimized) {
        renderMiddlePane();
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

async function renderMiddlePane() {
    const middlePane = document.getElementById('middle-pane') as HTMLDivElement;
    if (!middlePane || !isPreviewMinimized) return;

    if (selectedIndex < 0 || selectedIndex >= files.length) {
        middlePane.innerHTML = `<div style="display: flex; height: 100%; align-items: center; justify-content: center; color: var(--text-muted); font-size: 0.9rem; border: 1px dashed var(--border); border-radius: var(--radius-card); margin: 2px;">Select a folder to view contents</div>`;
        return;
    }

    const item = files[selectedIndex];
    if (!item.isDir) {
        middlePane.innerHTML = `<div style="display: flex; height: 100%; align-items: center; justify-content: center; color: var(--text-muted); font-size: 0.9rem; border: 1px dashed var(--border); border-radius: var(--radius-card); margin: 2px;">Item is not a folder</div>`;
        return;
    }

    if (isXRayMode) {
        middlePane.innerHTML = `<div style="display: flex; flex-direction: column; height: 100%; align-items: center; justify-content: center; gap: 12px; color: var(--warning); border: 1px dashed var(--border); border-radius: var(--radius-card); margin: 2px;">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon>
            </svg>
            <div>Running X-Ray Engine on ${item.name}...</div>
        </div>`;
    } else {
        middlePane.innerHTML = `<div style="padding: 16px; color: var(--text-secondary); text-align: center;">Loading folder contents...</div>`;
        try {
            const rawFiles = await ListFiles(item.path);
            const folderFiles = rawFiles.filter(f => f.name !== '../');
            
            if (folderFiles.length === 0) {
                middlePane.innerHTML = `<div style="display: flex; height: 100%; align-items: center; justify-content: center; color: var(--text-muted); font-size: 0.9rem; border: 1px dashed var(--border); border-radius: var(--radius-card); margin: 2px;">Folder is empty</div>`;
                return;
            }

            let html = `<ul class="file-list" style="flex: 1; width: 100%; overflow-y: auto; height: 100%; border: 1px solid var(--border); border-radius: var(--radius-card); margin: 2px; background: var(--bg-card);">`;
            folderFiles.forEach(f => {
                const icon = getFileIcon(f.isDir, f.ext, f.previewType);
                html += `
                    <li class="file-item">
                        <div class="file-info" style="flex: 1;">
                            <div style="display: flex; align-items: center;">
                                <span class="file-icon" style="display: flex; align-items: center; justify-content: center; width: 20px; height: 20px; flex-shrink: 0; color: inherit; margin-right: 8px;">
                                    ${icon}
                                </span>
                                <div style="display: flex; flex-direction: column; justify-content: center;">
                                    <span style="font-weight: 500;">${f.name}</span>
                                    <span class="file-meta-small">${f.isDir ? 'Folder' : f.sizeMB.toFixed(2) + ' MB'}</span>
                                </div>
                            </div>
                        </div>
                    </li>
                `;
            });
            html += `</ul>`;
            middlePane.innerHTML = html;
        } catch (e) {
            middlePane.innerHTML = `<div style="display: flex; height: 100%; align-items: center; justify-content: center; color: var(--danger); font-size: 0.9rem; border: 1px dashed var(--border); border-radius: var(--radius-card); margin: 2px;">Failed to load directory</div>`;
        }
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

    if (file.previewType === 'image' || file.previewType === 'video' || file.previewType === 'pdf') {
        previewContentEl.innerHTML = `<div style="padding: 16px; color: var(--text-secondary); text-align: center;">Loading media...</div>`;

        GetMediaServerURL().then(serverUrl => {
            if (selectedIndex !== -1 && files[selectedIndex].path !== file.path) return;

            const mediaUrl = `${serverUrl}/video-preview?path=${encodeURIComponent(file.path)}`;

            switch (file.previewType) {
                case 'image':
                    previewContentEl.innerHTML = `<img src="${mediaUrl}" class="preview-img">`;
                    break;
                case 'video':
                    previewContentEl.innerHTML = `
                        <div class="preview-video-container" id="triage-video-container">
                            <button id="btn-native-video" class="btn-native-player">Open in System Player</button>
                        </div>
                    `;
                    const vidEl = document.createElement('video');
                    vidEl.src = mediaUrl;
                    vidEl.className = 'preview-video';
                    vidEl.controls = true;
                    vidEl.autoplay = true;
                    vidEl.loop = true;
                    vidEl.setAttribute('muted', 'true');
                    vidEl.setAttribute('playsinline', 'true');
                    vidEl.muted = true;

                    setTimeout(() => {
                        const container = document.getElementById('triage-video-container');
                        if (container) container.insertBefore(vidEl, container.firstChild);

                        const btnNative = document.getElementById('btn-native-video');
                        if (btnNative) {
                            btnNative.onclick = () => OpenNative(file.path);
                        }
                    }, 0);
                    break;
                case 'pdf':
                    previewContentEl.innerHTML = `<embed src="${mediaUrl}" type="application/pdf" class="preview-pdf" style="width: 100%; height: 100%; border: none;"></embed>`;
                    break;
            }
        }).catch(err => {
            if (selectedIndex !== -1 && files[selectedIndex].path !== file.path) return;
            previewContentEl.innerHTML = `<div class="empty-state"><div class="empty-state-icon">!</div><p>Failed to load media</p><p style="font-size:0.75rem; color:var(--danger)">${err}</p></div>`;
        });
        return;
    }

    switch (file.previewType) {
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

function exitMultiSelectMode() {
    if (!isTriageMultiSelectMode) return;
    isTriageMultiSelectMode = false;
    triageSelectedIndices.clear();
    btnTriageSelectAll.style.display = 'none';
    btnTriageMultiselect.classList.remove('active');
}

async function handleAction() {
    if (files.length === 0) return;
    
    let targetIndices = [selectedIndex];
    if (isTriageMultiSelectMode && triageSelectedIndices.size > 0) {
        targetIndices = Array.from(triageSelectedIndices);
    }

    if (isTriageMultiSelectMode && targetIndices.some(idx => files[idx].isDir)) {
        // Block navigating into a directory when in multi-select mode
        return;
    }

    for (const idx of targetIndices) {
        const file = files[idx];
        if (file.isDir) {
            if (targetIndices.length === 1) {
                searchBar.value = '';
                await loadDirectory(file.path);
            }
        } else {
            await OpenNative(file.path);
        }
    }
    
    if (targetIndices.length > 1) {
        exitMultiSelectMode();
        renderFileList();
        updateSelection(true);
    }
}

async function handleMove(targetKey: string) {
    const targetDir = quickTargets[targetKey];
    if (!targetDir) return;
    if (files.length === 0) return;

    let targetIndices = [selectedIndex];
    if (isTriageMultiSelectMode && triageSelectedIndices.size > 0) {
        targetIndices = Array.from(triageSelectedIndices);
    }
    targetIndices = targetIndices.filter(i => files[i].name !== '../');
    if (targetIndices.length === 0) return;

    targetIndices.forEach(idx => {
        const el = document.getElementById(`item-${idx}`);
        if (el) el.classList.add('slide-out');
    });
    
    await new Promise(r => setTimeout(r, 150));
    await Promise.all(targetIndices.map(idx => MoveFile(files[idx].path, targetDir)));
    
    exitMultiSelectMode();
    await loadDirectory(currentPath, true);
}

async function handleTrash() {
    if (files.length === 0) return;

    let targetIndices = [selectedIndex];
    if (isTriageMultiSelectMode && triageSelectedIndices.size > 0) {
        targetIndices = Array.from(triageSelectedIndices);
    }
    targetIndices = targetIndices.filter(i => files[i].name !== '../');
    if (targetIndices.length === 0) return;

    targetIndices.forEach(idx => {
        const el = document.getElementById(`item-${idx}`);
        if (el) el.classList.add('slide-out');
    });
    
    await new Promise(r => setTimeout(r, 150));
    await Promise.all(targetIndices.map(idx => TrashFile(files[idx].path)));
    
    exitMultiSelectMode();
    await loadDirectory(currentPath, true);
}

function setupKeyboardListeners() {
    window.addEventListener('mouseup', () => { isDragging = false; });
    window.addEventListener('keydown', async (e) => {
        // Global Hotkeys for Tabs
        if (e.altKey) {
            if (e.key === '1') { e.preventDefault(); (window as any).switchTab('triage'); return; }
            if (e.key === '2') { e.preventDefault(); (window as any).switchTab('staging'); return; }
            if (e.key === '3') { e.preventDefault(); (window as any).switchTab('dupes'); return; }
        }

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
                if (document.getElementById('page-dupes')?.classList.contains('active')) {
                    // Dupes page navigation
                    let totalItems = 0;
                    dupeResults.forEach(g => totalItems += g.files.length);
                    if (lastSelectedDupeIndex < totalItems - 1) {
                        lastSelectedDupeIndex++;
                        selectedDupeIndices = new Set([lastSelectedDupeIndex]);
                        updateDupeSelection();
                    }
                } else if (document.getElementById('page-triage')?.classList.contains('active')) {
                    if (selectedIndex < files.length - 1) {
                        selectedIndex++;
                        updateSelection(true);
                    }
                }
                break;
            case 'ArrowUp':
                e.preventDefault();
                if (document.getElementById('page-dupes')?.classList.contains('active')) {
                    if (lastSelectedDupeIndex > 0) {
                        lastSelectedDupeIndex--;
                        selectedDupeIndices = new Set([lastSelectedDupeIndex]);
                        updateDupeSelection();
                    }
                } else if (document.getElementById('page-triage')?.classList.contains('active')) {
                    if (selectedIndex > 0) {
                        selectedIndex--;
                        updateSelection(true);
                    }
                }
                break;
            case 'Enter':
                e.preventDefault();
                if (document.getElementById('page-dupes')?.classList.contains('active')) {
                    const item = getSelectedDupeItem();
                    if (item) await OpenNative(item);
                } else if (document.getElementById('page-triage')?.classList.contains('active')) {
                    await handleAction();
                }
                break;
            case 'r':
            case 'R':
                e.preventDefault();
                if (document.getElementById('page-dupes')?.classList.contains('active')) {
                    const btnDupeTrash = document.getElementById('btn-dupe-trash');
                    if (btnDupeTrash) btnDupeTrash.click();
                } else if (document.getElementById('page-triage')?.classList.contains('active')) {
                    await handleTrash();
                }
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

function waitForWails(): Promise<void> {
    return new Promise((resolve) => {
        const check = () => {
            if ((window as any).go && (window as any).go.gui) {
                resolve();
            } else {
                setTimeout(check, 50);
            }
        };
        check();
    });
}

document.addEventListener("DOMContentLoaded", async () => {
    await waitForWails();
    init();
});
