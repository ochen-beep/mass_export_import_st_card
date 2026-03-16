// Export All Cards ZIP v1.3 — fork by aceenvw
const MODULE_NAME = 'export_all_cards_zip';

let abortExport = false;
let abortImport = false;
let jsZipLoaded = false;
let exportInProgress = false;
let importInProgress = false;

// ─── JSZip ───
async function loadJSZip() {
    if (jsZipLoaded && typeof window.JSZip === 'function') return true;
    jsZipLoaded = false;
    return new Promise((resolve) => {
        const existing = document.querySelector('script[data-jszip]');
        if (existing) existing.remove();
        const script = document.createElement('script');
        script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
        script.setAttribute('data-jszip', '1');
        script.onload = () => { jsZipLoaded = true; resolve(true); };
        script.onerror = () => { console.error(`[${MODULE_NAME}] Failed to load JSZip`); resolve(false); };
        document.head.appendChild(script);
    });
}

// ─── Заголовки ST ───
function getHeaders() {
    try {
        if (typeof window.getRequestHeaders === 'function') return window.getRequestHeaders();
        const ctx = SillyTavern.getContext();
        if (typeof ctx.getRequestHeaders === 'function') return ctx.getRequestHeaders();
    } catch (e) {
        console.warn(`[${MODULE_NAME}] getHeaders fallback:`, e);
    }
    return { 'Content-Type': 'application/json' };
}

function safeName(name) {
    return name.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').replace(/\s+/g, ' ').trim() || 'unnamed';
}

// ─── UI helpers ───
function el(id) { return document.getElementById(id); }

function setStatus(prefix, text, isError = false) {
    const e = el(`${prefix}-status`);
    if (!e) return;
    e.textContent = text;
    e.style.color = isError ? 'var(--export-cards-error, #e07070)' : '';
}

function setProgress(prefix, current, total) {
    const bar = el(`${prefix}-progress-bar`);
    const fill = el(`${prefix}-progress-fill`);
    const counter = el(`${prefix}-progress-counter`);
    if (!bar || !fill) return;
    bar.style.display = '';
    const pct = total > 0 ? Math.round((current / total) * 100) : 0;
    fill.style.width = `${pct}%`;
    if (counter) counter.textContent = `${current} / ${total}`;
}

function showLogButton(prefix, errors) {
    const btn = el(`${prefix}-log-btn`);
    if (!btn) return;
    if (errors && errors.length > 0) {
        btn.style.display = '';
        btn.dataset.log = errors.join('\n');
        btn.querySelector('.export-cards-log-count').textContent = `(${errors.length} error${errors.length > 1 ? 's' : ''})`;
    } else {
        btn.style.display = 'none';
    }
}

function downloadText(text, filename) {
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function resetExportUI() {
    exportInProgress = false; abortExport = false;
    const btn = el('export-cards-btn');
    if (btn) btn.classList.remove('disabled');
    const cancelBtn = el('export-cards-cancel-btn');
    if (cancelBtn) cancelBtn.style.display = 'none';
    const bar = el('export-cards-progress-bar');
    if (bar) bar.style.display = 'none';
    const fill = el('export-cards-progress-fill');
    if (fill) fill.style.width = '0%';
    const counter = el('export-cards-progress-counter');
    if (counter) counter.textContent = '';
    setStatus('export-cards', '');
}

function resetImportUI() {
    importInProgress = false; abortImport = false;
    const btn = el('import-cards-btn');
    if (btn) btn.classList.remove('disabled');
    const cancelBtn = el('import-cards-cancel-btn');
    if (cancelBtn) cancelBtn.style.display = 'none';
    const bar = el('import-cards-progress-bar');
    if (bar) bar.style.display = 'none';
    const fill = el('import-cards-progress-fill');
    if (fill) fill.style.width = '0%';
    const counter = el('import-cards-progress-counter');
    if (counter) counter.textContent = '';
    const fileInput = el('import-cards-file-input');
    if (fileInput) fileInput.value = '';
    setStatus('import-cards', '');
}

// ─── Уникальное имя (для auto-rename) ───
function getUniqueName(usedNames, baseName) {
    let name = baseName;
    let i = 2;
    while (usedNames.has(name.toLowerCase())) name = `${baseName} (${i++})`;
    usedNames.add(name.toLowerCase());
    return name;
}

// ─── API: экспорт одного персонажа ───
async function fetchCharacterPng(avatarUrl) {
    try {
        const r = await fetch('/api/characters/export', {
            method: 'POST',
            headers: getHeaders(),
            body: JSON.stringify({ format: 'png', avatar_url: avatarUrl }),
        });
        if (!r.ok) { console.warn(`[${MODULE_NAME}] export HTTP ${r.status} for ${avatarUrl}`); return null; }
        const blob = await r.blob();
        return blob && blob.size > 0 ? blob : null;
    } catch (e) {
        console.warn(`[${MODULE_NAME}] fetchCharacterPng:`, e);
        return null;
    }
}

// ─── API: импорт одного PNG ───
async function importCharacterPng(filename, blob) {
    try {
        const formData = new FormData();
        formData.append('avatar', blob, filename);
        formData.append('file_type', 'png'); // FIX: required by server to select import handler
        const baseHeaders = getHeaders();
        const headers = Object.fromEntries(
            Object.entries(baseHeaders).filter(([k]) => k.toLowerCase() !== 'content-type')
        );
        const r = await fetch('/api/characters/import', { method: 'POST', headers, body: formData });
        if (!r.ok) {
            const text = await r.text().catch(() => '');
            console.warn(`[${MODULE_NAME}] import HTTP ${r.status} for ${filename}: ${text}`);
            return { ok: false, reason: `HTTP ${r.status}` };
        }
        // Server returns { file_name } on success or { error: true } on failure
        const json = await r.json().catch(() => null);
        if (json && json.error) {
            console.warn(`[${MODULE_NAME}] import server error for ${filename}:`, json);
            return { ok: false, reason: 'Server error (invalid character card?)' };
        }
        return { ok: true };
    } catch (e) {
        console.warn(`[${MODULE_NAME}] importCharacterPng:`, e);
        return { ok: false, reason: e.message };
    }
}

// ═══════════════════════════════════
// ─── ЭКСПОРТ ───
// ═══════════════════════════════════
async function exportAllAsZip() {
    if (exportInProgress) return;

    const ctx = SillyTavern.getContext();
    const characters = ctx?.characters;
    if (!characters || characters.length === 0) { toastr.warning('No characters found.'); return; }

    const duplicatePolicy = el('export-cards-duplicate-policy')?.value || 'rename';
    const confirmed = confirm(
        `Export ${characters.length} character(s) as PNG into a ZIP?\n\nDuplicate names: ${duplicatePolicy === 'rename' ? 'auto-rename' : 'skip'}.`
    );
    if (!confirmed) return;

    exportInProgress = true; abortExport = false;
    el('export-cards-btn')?.classList.add('disabled');
    const cancelBtn = el('export-cards-cancel-btn');
    if (cancelBtn) cancelBtn.style.display = '';
    showLogButton('export-cards', null);

    setStatus('export-cards', 'Loading ZIP library...');
    if (!await loadJSZip()) {
        toastr.error('Failed to load JSZip. Check internet connection.');
        resetExportUI(); return;
    }

    const zip = new JSZip();
    const total = characters.length;
    let exported = 0, skipped = 0, failed = 0;
    const usedNames = new Set();
    const errors = [];

    for (let i = 0; i < total; i++) {
        if (abortExport) { toastr.warning(`Export cancelled. ${exported}/${total} exported.`); break; }

        const char = characters[i];
        const charName = char.name || 'unnamed';

        if (!char.avatar) { errors.push(`${charName}: no avatar URL`); failed++; continue; }

        const sanitized = safeName(charName);
        const isDuplicate = usedNames.has(sanitized.toLowerCase());

        if (isDuplicate && duplicatePolicy === 'skip') {
            errors.push(`${charName}: skipped (duplicate name)`);
            skipped++;
            setProgress('export-cards', i + 1, total);
            setStatus('export-cards', `Skipped ${i + 1}/${total}: ${charName} (duplicate)`);
            continue;
        }

        setProgress('export-cards', i + 1, total);
        setStatus('export-cards', `Exporting ${i + 1}/${total}: ${charName}`);

        const blob = await fetchCharacterPng(char.avatar);
        if (blob) {
            const uniqueName = getUniqueName(usedNames, sanitized);
            zip.file(`${uniqueName}.png`, blob);
            exported++;
        } else {
            errors.push(`${charName}: export failed`);
            failed++;
            // имя всё равно резервируем чтобы счётчик не сбился
            usedNames.add(sanitized.toLowerCase());
        }

        if (i < total - 1) await new Promise(r => setTimeout(r, 80));
    }

    if (abortExport && exported === 0) { resetExportUI(); return; }

    if (exported === 0) {
        toastr.error('No characters exported. Check console (F12).');
        showLogButton('export-cards', errors);
        resetExportUI(); return;
    }

    if (errors.length > 0) {
        zip.file('_export_errors.txt', errors.join('\n'));
        console.warn(`[${MODULE_NAME}] Export errors:`, errors);
    }

    setStatus('export-cards', 'Generating ZIP...');
    setProgress('export-cards', 0, total);

    let zipBlob;
    try {
        zipBlob = await zip.generateAsync(
            { type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } },
            (meta) => setProgress('export-cards', Math.round(meta.percent * total / 100), total)
        );
    } catch (e) {
        console.error(`[${MODULE_NAME}] ZIP generation failed:`, e);
        toastr.error('Failed to generate ZIP.');
        showLogButton('export-cards', errors);
        resetExportUI(); return;
    }

    const ts = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, -5);
    const sizeMB = (zipBlob.size / 1024 / 1024).toFixed(1);
    downloadBlob(zipBlob, `all_characters_${ts}.zip`);

    let msg = `Exported ${exported}/${total} character(s). ZIP: ${sizeMB} MB.`;
    if (skipped > 0) msg += ` ${skipped} skipped.`;
    if (failed > 0) msg += ` ${failed} failed.`;
    toastr.success(msg);

    setStatus('export-cards', `Done. ${exported} exported${failed > 0 ? `, ${failed} failed` : ''}${skipped > 0 ? `, ${skipped} skipped` : ''}.`);
    showLogButton('export-cards', errors.length > 0 ? errors : null);
    resetExportUI();
}

// ═══════════════════════════════════
// ─── ИМПОРТ ───
// ═══════════════════════════════════
async function importFromZip(file) {
    if (importInProgress) return;
    if (!file?.name.toLowerCase().endsWith('.zip')) { toastr.warning('Please select a .zip file.'); return; }

    importInProgress = true; abortImport = false;
    el('import-cards-btn')?.classList.add('disabled');
    const cancelBtn = el('import-cards-cancel-btn');
    if (cancelBtn) cancelBtn.style.display = '';
    showLogButton('import-cards', null);

    setStatus('import-cards', 'Loading ZIP library...');
    if (!await loadJSZip()) {
        toastr.error('Failed to load JSZip. Check internet connection.');
        resetImportUI(); return;
    }

    let zip;
    try {
        setStatus('import-cards', 'Reading ZIP...');
        zip = await JSZip.loadAsync(await file.arrayBuffer());
    } catch (e) {
        console.error(`[${MODULE_NAME}] Read ZIP failed:`, e);
        toastr.error('Failed to read ZIP. Is it a valid archive?');
        resetImportUI(); return;
    }

    const pngFiles = Object.entries(zip.files).filter(
        ([name, entry]) => !entry.dir && name.toLowerCase().endsWith('.png') && !name.startsWith('__MACOSX')
    );

    if (pngFiles.length === 0) { toastr.warning('No PNG files found in ZIP.'); resetImportUI(); return; }

    // ─── Сбор существующих имён для проверки дублей ───
    const ctx = SillyTavern.getContext();
    const existingNames = new Set(
        (ctx?.characters || []).map(c => (c.name || '').toLowerCase().trim())
    );

    // ─── Подсчёт дублей для информирования ───
    const duplicatePolicy = el('import-cards-duplicate-policy')?.value || 'rename';
    const duplicateCount = pngFiles.filter(([name]) => {
        const charName = name.split('/').pop().replace(/\.png$/i, '').toLowerCase().trim();
        return existingNames.has(charName);
    }).length;

    let confirmMsg = `Found ${pngFiles.length} PNG file(s) in the archive.`;
    if (duplicateCount > 0) {
        const policyLabel = { rename: 'auto-rename', skip: 'skip', anyway: 'import anyway (creates duplicate)' };
        confirmMsg += `\n\n${duplicateCount} name conflict(s) found.\nPolicy: ${policyLabel[duplicatePolicy] || duplicatePolicy}.`;
    }
    confirmMsg += '\n\nProceed with import?';

    if (!confirm(confirmMsg)) { resetImportUI(); return; }

    const total = pngFiles.length;
    let imported = 0, skipped = 0, failed = 0;
    const usedNames = new Set(existingNames); // начинаем с уже занятых имён
    const errors = [];

    for (let i = 0; i < total; i++) {
        if (abortImport) { toastr.warning(`Import cancelled. ${imported}/${total} imported.`); break; }

        const [fullPath, entry] = pngFiles[i];
        const filename = fullPath.split('/').pop();
        const charName = filename.replace(/\.png$/i, '').trim();
        const charNameLower = charName.toLowerCase();

        setProgress('import-cards', i + 1, total);
        setStatus('import-cards', `Importing ${i + 1}/${total}: ${charName}`);

        // ─── Проверка дубля ───
        if (existingNames.has(charNameLower)) {
            if (duplicatePolicy === 'skip') {
                errors.push(`${charName}: skipped (already exists)`);
                skipped++;
                continue;
            }
            // 'rename' или 'anyway': продолжаем, но для rename меняем имя файла
        }

        let blob;
        try {
            blob = new Blob([await entry.async('arraybuffer')], { type: 'image/png' });
        } catch (e) {
            errors.push(`${charName}: failed to read from ZIP`);
            failed++; continue;
        }

        if (!blob || blob.size < 100) {
            errors.push(`${charName}: file too small or empty`);
            skipped++; continue;
        }

        // Для auto-rename: создаём новое имя файла с суффиксом
        let importFilename = filename;
        if (duplicatePolicy === 'rename' && existingNames.has(charNameLower)) {
            const newName = getUniqueName(usedNames, safeName(charName));
            importFilename = `${newName}.png`;
        } else {
            usedNames.add(charNameLower);
        }

        const result = await importCharacterPng(importFilename, blob);
        if (result.ok) {
            imported++;
            existingNames.add(charNameLower); // помечаем как занятое для следующих итераций
        } else {
            errors.push(`${charName}: ${result.reason}`);
            failed++;
        }

        if (i < total - 1) await new Promise(r => setTimeout(r, 100));
    }

    // ─── Обновляем список персонажей ───
    if (imported > 0) {
        try {
            const ctx2 = SillyTavern.getContext();
            // ST exposes event/eventSource for triggering UI reload
            if (ctx2?.eventSource && ctx2?.event?.CHARACTER_PAGE_LOADED) {
                await ctx2.eventSource.emit(ctx2.event.CHARACTER_PAGE_LOADED);
            } else if (typeof getCharacters === 'function') {
                // Fallback: global getCharacters() present in some ST versions
                await getCharacters();
            }
        } catch (e) {
            console.warn(`[${MODULE_NAME}] Could not refresh character list:`, e);
        }
    }

    if (errors.length > 0) console.warn(`[${MODULE_NAME}] Import errors:`, errors);

    let msg = `Imported ${imported}/${total} character(s).`;
    if (skipped > 0) msg += ` ${skipped} skipped.`;
    if (failed > 0) msg += ` ${failed} failed.`;

    if (imported > 0) toastr.success(msg);
    else if (failed > 0) toastr.error(msg);
    else toastr.warning(msg);

    setStatus('import-cards',
        `Done. ${imported} imported${skipped > 0 ? `, ${skipped} skipped` : ''}${failed > 0 ? `, ${failed} failed` : ''}.`,
        failed > 0 && imported === 0
    );
    showLogButton('import-cards', errors.length > 0 ? errors : null);
    resetImportUI();
}

// ═══════════════════════════════════
// ─── UI ───
// ═══════════════════════════════════
function createUI() {
    const html = `
        <div id="export-cards-settings">
            <div class="inline-drawer">
                <div class="inline-drawer-toggle inline-drawer-header">
                    <b>Export / Import Cards ZIP</b>
                    <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
                </div>
                <div class="inline-drawer-content">

                    <!-- ── EXPORT ── -->
                    <div class="export-cards-section-label">Export</div>
                    <div class="export-cards-policy-row">
                        <label for="export-cards-duplicate-policy">On duplicate:</label>
                        <select id="export-cards-duplicate-policy">
                            <option value="rename">Auto-rename</option>
                            <option value="skip">Skip</option>
                        </select>
                    </div>
                    <div id="export-cards-btn" class="menu_button">
                        <i class="fa-solid fa-box-archive"></i>
                        <span>Export All as ZIP</span>
                    </div>
                    <div id="export-cards-cancel-btn" class="menu_button export-cards-cancel" style="display:none;">
                        <i class="fa-solid fa-xmark"></i>
                        <span>Cancel Export</span>
                    </div>
                    <div class="export-cards-progress-row" style="display:none;" id="export-cards-progress-bar">
                        <div class="export-cards-bar-wrap">
                            <div id="export-cards-progress-fill" class="export-cards-bar-fill green"></div>
                        </div>
                        <span id="export-cards-progress-counter" class="export-cards-counter"></span>
                    </div>
                    <div id="export-cards-status" class="export-cards-status"></div>
                    <button id="export-cards-log-btn" class="export-cards-log-btn" style="display:none;">
                        <span class="export-cards-log-dot"></span>
                        Download export log <span class="export-cards-log-count"></span>
                    </button>

                    <div class="export-cards-divider"></div>

                    <!-- ── IMPORT ── -->
                    <div class="export-cards-section-label">Import</div>
                    <div class="export-cards-policy-row">
                        <label for="import-cards-duplicate-policy">On duplicate:</label>
                        <select id="import-cards-duplicate-policy">
                            <option value="rename">Auto-rename</option>
                            <option value="skip">Skip</option>
                            <option value="anyway">Import anyway</option>
                        </select>
                    </div>
                    <div id="import-cards-btn" class="menu_button">
                        <i class="fa-solid fa-file-import"></i>
                        <span>Import from ZIP</span>
                    </div>
                    <div id="import-cards-cancel-btn" class="menu_button export-cards-cancel" style="display:none;">
                        <i class="fa-solid fa-xmark"></i>
                        <span>Cancel Import</span>
                    </div>
                    <div class="export-cards-progress-row" style="display:none;" id="import-cards-progress-bar">
                        <div class="export-cards-bar-wrap">
                            <div id="import-cards-progress-fill" class="export-cards-bar-fill blue"></div>
                        </div>
                        <span id="import-cards-progress-counter" class="export-cards-counter"></span>
                    </div>
                    <div id="import-cards-status" class="export-cards-status"></div>
                    <button id="import-cards-log-btn" class="export-cards-log-btn" style="display:none;">
                        <span class="export-cards-log-dot"></span>
                        Download import log <span class="export-cards-log-count"></span>
                    </button>

                    <input type="file" id="import-cards-file-input" accept=".zip" style="display:none;">
                </div>
            </div>
        </div>
    `;

    $('#extensions_settings2').append(html);

    // ── Export ──
    $('#export-cards-btn').on('click', async function () {
        if ($(this).hasClass('disabled')) return;
        await exportAllAsZip();
    });
    $('#export-cards-cancel-btn').on('click', () => {
        abortExport = true;
        el('export-cards-cancel-btn').style.display = 'none';
        setStatus('export-cards', 'Cancelling...');
    });
    $('#export-cards-log-btn').on('click', function () {
        const log = this.dataset.log;
        if (log) {
            const ts = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, -5);
            downloadText(log, `export_log_${ts}.txt`);
        }
    });

    // ── Import ──
    $('#import-cards-btn').on('click', function () {
        if ($(this).hasClass('disabled')) return;
        el('import-cards-file-input').click();
    });
    $('#import-cards-file-input').on('change', async function () {
        const file = this.files[0];
        if (file) await importFromZip(file);
    });
    $('#import-cards-cancel-btn').on('click', () => {
        abortImport = true;
        el('import-cards-cancel-btn').style.display = 'none';
        setStatus('import-cards', 'Cancelling...');
    });
    $('#import-cards-log-btn').on('click', function () {
        const log = this.dataset.log;
        if (log) {
            const ts = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, -5);
            downloadText(log, `import_log_${ts}.txt`);
        }
    });
}

createUI();
console.log(`[${MODULE_NAME}] Extension loaded (v1.3).`);
