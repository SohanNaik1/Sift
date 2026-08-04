import './style.css';
// @ts-ignore
import {ListFiles, GetQuickTargets, TrashFile, MoveFile, GetFilePreview, Quit, PickDirectory} from '../wailsjs/go/gui/Controller';

interface FileEntry {
    name: string;
    path: string;
    isDir: boolean;
    sizeMB: number;
    modTime: string;
    perms: string;
    previewType: string;
    mime: string;
}

let currentPath = '~';
let files: FileEntry[] = [];
let selectedIndex = 0;
let quickTargets: Record<string, string> = {};

const fileListEl = document.getElementById('file-list') as HTMLUListElement;
const currentPathEl = document.getElementById('current-path') as HTMLDivElement;
const previewTitleEl = document.getElementById('preview-title') as HTMLHeadingElement;
const fileMetaEl = document.getElementById('file-meta') as HTMLDivElement;
const previewContentEl = document.getElementById('preview-content') as HTMLDivElement;

const btnOpen = document.getElementById('btn-open') as HTMLButtonElement;
const btnTrash = document.getElementById('btn-trash') as HTMLButtonElement;
const btnCustomMove = document.getElementById('btn-custom-move') as HTMLButtonElement;
const btnQuit = document.getElementById('btn-quit') as HTMLButtonElement;
const mouseTargets = document.getElementById('mouse-quick-targets') as HTMLDivElement;

async function init() {
    quickTargets = await GetQuickTargets();
    renderQuickTargets();
    setupMouseControls();
    await loadDirectory(currentPath);
    setupKeyboardListeners();
}

function renderQuickTargets() {
    mouseTargets.innerHTML = '';
    for (const [key, path] of Object.entries(quickTargets)) {
        const btn = document.createElement('button');
        btn.className = 'action-btn';
        btn.innerHTML = `${key}: ${path.split('/').pop() || path}`;
        btn.title = `Move to ${path}`;
        btn.onclick = () => handleMove(key);
        mouseTargets.appendChild(btn);
    }
}

function setupMouseControls() {
    btnOpen.onclick = handleAction;
    btnTrash.onclick = handleTrash;
    btnCustomMove.onclick = handlePickDirectory;
    btnQuit.onclick = async () => {
        await Quit();
    };
}

async function loadDirectory(path: string, preserveIndex: boolean = false) {
    try {
        const oldIndex = selectedIndex;
        files = await ListFiles(path);
        
        if (files.length > 0) {
            if (files[0].name === '../' && files.length > 1) {
                currentPath = files[1].path.substring(0, files[1].path.lastIndexOf('/'));
            } else if (files.length > 0 && files[0].name !== '../') {
                currentPath = files[0].path.substring(0, files[0].path.lastIndexOf('/'));
            } else {
                currentPath = path;
            }
            currentPathEl.textContent = currentPath;
        }

        if (preserveIndex) {
            selectedIndex = Math.min(oldIndex, Math.max(0, files.length - 1));
        } else {
            selectedIndex = 0;
        }
        
        renderFileList();
        updateSelection(true); // render preview as well
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
        
        let iconClass = 'icon-none';
        if (file.isDir) iconClass = 'icon-dir';
        else if (file.previewType === 'image') iconClass = 'icon-image';
        else if (file.previewType === 'video') iconClass = 'icon-video';
        else if (file.previewType === 'pdf') iconClass = 'icon-pdf';
        else if (file.previewType === 'text') iconClass = 'icon-text';
        else if (file.previewType === 'document') iconClass = 'icon-doc';

        li.innerHTML = `
            <div class="file-info">
                <span class="file-name ${iconClass}">${file.name}</span>
                <span class="file-meta-small">${file.isDir ? 'Folder' : file.sizeMB.toFixed(2) + ' MB'} | ${file.modTime}</span>
            </div>
        `;
        li.onclick = () => {
            selectedIndex = index;
            updateSelection(true);
        };
        li.ondblclick = () => handleAction();
        fileListEl.appendChild(li);
    });
}

async function updateSelection(loadPreview: boolean = false) {
    // Remove old selected class
    const oldSelected = fileListEl.querySelector('.selected');
    if (oldSelected) oldSelected.classList.remove('selected');

    // Add new selected class
    const newSelected = document.getElementById(`item-${selectedIndex}`);
    if (newSelected) {
        newSelected.classList.add('selected');
        // Scroll into view if needed (smoothly or instantly depending on user preference, instant is snappier)
        newSelected.scrollIntoView({ block: 'nearest' });
    }

    if (loadPreview) {
        await renderPreview();
    }
}

async function renderPreview() {
    if (files.length === 0) {
        previewTitleEl.textContent = "Directory Empty";
        fileMetaEl.innerHTML = "";
        previewContentEl.innerHTML = `<div class="empty-state"><p>Empty</p></div>`;
        return;
    }

    const file = files[selectedIndex];
    previewTitleEl.textContent = file.name;
    
    if (file.name === '../') {
        fileMetaEl.innerHTML = `Go Up`;
        previewContentEl.innerHTML = `<div class="empty-state"><p>Parent Directory</p></div>`;
        return;
    }
    
    fileMetaEl.innerHTML = `
        Size: ${file.sizeMB.toFixed(2)} MB<br>
        Modified: ${file.modTime}<br>
        Perms: ${file.perms}
    `;

    if (file.isDir) {
        previewContentEl.innerHTML = `<div class="empty-state"><p>Folder</p></div>`;
        return;
    }

    const localUrl = `/local/${file.path}`;

    switch (file.previewType) {
        case 'image':
            previewContentEl.innerHTML = `<img src="${localUrl}" class="preview-img">`;
            break;
        case 'video':
            previewContentEl.innerHTML = `<video src="${localUrl}" class="preview-video" controls autoplay loop muted></video>`;
            break;
        case 'pdf':
            previewContentEl.innerHTML = `<iframe src="${localUrl}" class="preview-pdf"></iframe>`;
            break;
        case 'text':
        case 'document':
            previewContentEl.innerHTML = `<div class="empty-state"><p>Loading document text...</p></div>`;
            try {
                // Fetch text preview only when clicked
                const preview = await GetFilePreview(file.path);
                const safeText = preview.text.replace(/</g, "&lt;").replace(/>/g, "&gt;");
                previewContentEl.innerHTML = `<pre class="preview-text">${safeText}</pre>`;
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
        await loadDirectory(file.path);
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

async function handlePickDirectory() {
    if (files.length === 0) return;
    const file = files[selectedIndex];
    if (file.name === '../') return;

    const targetDir = await PickDirectory();
    if (targetDir && targetDir !== "") {
        await MoveFile(file.path, targetDir);
        await loadDirectory(currentPath, true);
    }
}

function setupKeyboardListeners() {
    window.addEventListener('keydown', async (e) => {
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
            case 'c':
            case 'C':
                e.preventDefault();
                await handlePickDirectory();
                break;
            case 'r':
            case 'R':
                e.preventDefault();
                await handleTrash();
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
