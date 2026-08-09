import './style.css';
import * as Sentry from '@sentry/browser';
// @ts-ignore
import { ListFiles, GetQuickTargets, TrashFile, MoveFile, GetFilePreview, Quit, PickDirectory, OpenNative, GetTrashPath, PinTarget, CheckForUpdates, FindDuplicates, GetMediaServerURL, EmptyTrash } from '../wailsjs/go/gui/Controller';
// @ts-ignore
import { BrowserOpenURL } from '../wailsjs/runtime/runtime';

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
const btnTrashPortalDupes = document.getElementById('btn-trash-portal-dupes') as HTMLButtonElement;
const btnEmptyTrash = document.getElementById('btn-empty-trash') as HTMLButtonElement;
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
    btnHome.onclick = async () => {
        searchBar.value = '';
        await loadDirectory('~');
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
                    <div class="file-name"><span class="badge badge-dir">DIR</span> <span>${dir}</span></div>
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
            li.innerHTML = `
                <div class="file-info">
                    <div class="file-name"><span>${file.split('/').pop() || file.split('\\').pop()}</span></div>
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
    if (oldSelected) {
        oldSelected.classList.remove('selected');
        oldSelected.classList.remove('active-preview');
    }

    const newSelected = document.getElementById(`item-${selectedIndex}`);
    if (newSelected) {
        newSelected.classList.add('selected');
        newSelected.classList.add('active-preview');
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

    const el = document.getElementById(`item-${selectedIndex}`);
    if (el) {
        el.classList.add('slide-out');
        await new Promise(r => setTimeout(r, 150));
    }

    await MoveFile(file.path, targetDir);
    await loadDirectory(currentPath, true);
}

async function handleTrash() {
    if (files.length === 0) return;
    const file = files[selectedIndex];
    if (file.name === '../') return;

    const el = document.getElementById(`item-${selectedIndex}`);
    if (el) {
        el.classList.add('slide-out');
        await new Promise(r => setTimeout(r, 150));
    }

    await TrashFile(file.path);
    await loadDirectory(currentPath, true);
}

function setupKeyboardListeners() {
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
                if (document.getElementById('page-dupes')?.style.display === 'flex') {
                    // Dupes page navigation
                    let totalItems = 0;
                    dupeResults.forEach(g => totalItems += g.files.length);
                    if (lastSelectedDupeIndex < totalItems - 1) {
                        lastSelectedDupeIndex++;
                        selectedDupeIndices = new Set([lastSelectedDupeIndex]);
                        updateDupeSelection();
                    }
                } else if (document.getElementById('page-triage')?.style.display === 'flex') {
                    if (selectedIndex < files.length - 1) {
                        selectedIndex++;
                        updateSelection(true);
                    }
                }
                break;
            case 'ArrowUp':
                e.preventDefault();
                if (document.getElementById('page-dupes')?.style.display === 'flex') {
                    if (lastSelectedDupeIndex > 0) {
                        lastSelectedDupeIndex--;
                        selectedDupeIndices = new Set([lastSelectedDupeIndex]);
                        updateDupeSelection();
                    }
                } else if (document.getElementById('page-triage')?.style.display === 'flex') {
                    if (selectedIndex > 0) {
                        selectedIndex--;
                        updateSelection(true);
                    }
                }
                break;
            case 'Enter':
                e.preventDefault();
                if (document.getElementById('page-dupes')?.style.display === 'flex') {
                    const item = getSelectedDupeItem();
                    if (item) await OpenNative(item);
                } else if (document.getElementById('page-triage')?.style.display === 'flex') {
                    await handleAction();
                }
                break;
            case 'r':
            case 'R':
                e.preventDefault();
                if (document.getElementById('page-dupes')?.style.display === 'flex') {
                    const btnDupeTrash = document.getElementById('btn-dupe-trash');
                    if (btnDupeTrash) btnDupeTrash.click();
                } else if (document.getElementById('page-triage')?.style.display === 'flex') {
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
