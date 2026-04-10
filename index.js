// Export / Import Cards ZIP v1.4
const MODULE_NAME = 'export_all_cards_zip';

let abortExport    = false;
let abortImport    = false;
let jsZipLoaded    = false;
let jsZipLoadPromise = null; // кешируем промис чтобы loadJSZip была идемпотентной
let exportInProgress = false;
let importInProgress = false;

const MAX_ZIP_WARN_MB = 200; // предупреждать если ZIP крупнее этого порога

// ═══════════════════════════════════
// ─── JSZip ───
// ═══════════════════════════════════
// FIX: кешируем промис загрузки — повторный вызов до завершения вернёт тот же промис,
//      а не запустит второй <script> (что ломало первый onload навсегда).
// FIX: таймаут 10 с — если CDN завис (не ошибка, а молчит), промис всё равно resolve(false),
//      интерфейс не зависает навечно.
async function loadJSZip() {
    if (jsZipLoaded && typeof window.JSZip === 'function') return true;
    if (jsZipLoadPromise) return jsZipLoadPromise;

    jsZipLoadPromise = new Promise((resolve) => {
        const script = document.createElement('script');
        script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
        script.setAttribute('data-jszip', '1');

        const timer = setTimeout(() => {
            script.remove();
            console.error(`[${MODULE_NAME}] JSZip load timeout (10s)`);
            resolve(false);
        }, 10000);

        script.onload = () => {
            clearTimeout(timer);
            jsZipLoaded = true;
            resolve(true);
        };
        script.onerror = () => {
            clearTimeout(timer);
            console.error(`[${MODULE_NAME}] Failed to load JSZip`);
            resolve(false);
        };

        document.head.appendChild(script);
    }).finally(() => {
        // сбрасываем после завершения — следующий вызов сможет попробовать снова при необходимости
        jsZipLoadPromise = null;
    });

    return jsZipLoadPromise;
}

// ═══════════════════════════════════
// ─── Заголовки ST ───
// ═══════════════════════════════════
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

// ═══════════════════════════════════
// ─── Утилиты ───
// ═══════════════════════════════════
function safeName(name) {
    return name.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').replace(/\s+/g, ' ').trim() || 'unnamed';
}

// FIX: showConfirm использует ST Popup API (работает на мобильных, не блокирует event loop),
//      с graceful fallback на нативный confirm() для старых версий ST.
async function showConfirm(title, text) {
    try {
        const ctx = SillyTavern.getContext();
        // Popup.show.confirm доступен в современных версиях ST
        if (typeof ctx?.Popup?.show?.confirm === 'function') {
            return await ctx.Popup.show.confirm(title, text);
        }
    } catch (e) {
        console.warn(`[${MODULE_NAME}] Popup fallback:`, e);
    }
    // Fallback: нативный confirm (синхронный, может блокироваться на мобильных)
    return confirm(`${title}\n\n${text}`);
}

// ═══════════════════════════════════
// ─── UI helpers ───
// ═══════════════════════════════════
function el(id) { return document.getElementById(id); }

function setStatus(prefix, text, isError = false) {
    const e = el(`${prefix}-status`);
    if (!e) return;
    e.textContent = text;
    e.style.color = isError ? 'var(--export-cards-error, #e07070)' : '';
}

function setProgress(prefix, current, total) {
    const bar     = el(`${prefix}-progress-bar`);
    const fill    = el(`${prefix}-progress-fill`);
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
        btn.querySelector('.export-cards-log-count').textContent =
            `(${errors.length} error${errors.length > 1 ? 's' : ''})`;
    } else {
        btn.style.display = 'none';
    }
}

// ─── Скачивание файлов ───
// FIX: на Android Chromium blob URL через a.click() часто открывает файл в браузере
//      вместо скачивания. Используем data URL через FileReader — более совместимо.
function downloadViaDataUrl(blob, filename) {
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => {
            const a = document.createElement('a');
            a.href = reader.result;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            resolve();
        };
        reader.onerror = () => resolve(); // молча игнорируем, fallback ниже
        reader.readAsDataURL(blob);
    });
}

const isMobileChromium = /Android.*Chrome|Chrome.*Android/i.test(navigator.userAgent);

async function downloadBlob(blob, filename) {
    if (isMobileChromium) {
        // На Android data URL скачивается надёжнее чем blob URL
        await downloadViaDataUrl(blob, filename);
        return;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function downloadText(text, filename) {
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    await downloadBlob(blob, filename);
}

// ─── Сброс UI ───
// FIX: убран вызов setStatus('') — финальный статус 'Done. N exported' больше не затирается.
//      Сбрасываются только флаги, кнопки и прогресс-бар.
function resetExportUI() {
    exportInProgress = false;
    abortExport      = false;
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
    // статус намеренно НЕ сбрасываем — пользователь должен видеть итог
}

function resetImportUI() {
    importInProgress = false;
    abortImport      = false;
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
    // статус намеренно НЕ сбрасываем — пользователь должен видеть итог
}

// ─── Уникальное имя (для auto-rename) ───
function getUniqueName(usedNames, baseName) {
    let name = baseName;
    let i = 2;
    while (usedNames.has(name.toLowerCase())) name = `${baseName} (${i++})`;
    usedNames.add(name.toLowerCase());
    return name;
}

// ═══════════════════════════════════
// ─── API: экспорт одного персонажа ───
// ═══════════════════════════════════
async function fetchCharacterPng(avatarUrl) {
    try {
        const r = await fetch('/api/characters/export', {
            method: 'POST',
            headers: getHeaders(),
            body: JSON.stringify({ format: 'png', avatar_url: avatarUrl }),
        });
        if (!r.ok) {
            console.warn(`[${MODULE_NAME}] export HTTP ${r.status} for ${avatarUrl}`);
            return null;
        }
        const blob = await r.blob();
        return blob && blob.size > 0 ? blob : null;
    } catch (e) {
        console.warn(`[${MODULE_NAME}] fetchCharacterPng:`, e);
        return null;
    }
}

// ═══════════════════════════════════
// ─── API: импорт одного PNG ───
// ═══════════════════════════════════
async function importCharacterPng(filename, blob) {
    try {
        const formData = new FormData();
        formData.append('avatar', blob, filename);
        formData.append('file_type', 'png');
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
    // FIX: exportInProgress = true сразу, ДО любого await,
    //      иначе двойной быстрый клик запускает два параллельных экспорта.
    if (exportInProgress) return;
    exportInProgress = true;
    abortExport = false;

    const ctx = SillyTavern.getContext();
    const characters = ctx?.characters;
    if (!characters || characters.length === 0) {
        toastr.warning('No characters found.');
        exportInProgress = false;
        return;
    }

    const duplicatePolicy = el('export-cards-duplicate-policy')?.value || 'rename';
    const policyLabel = duplicatePolicy === 'rename' ? 'auto-rename' : 'skip';
    const confirmed = await showConfirm(
        'Export characters',
        `Export ${characters.length} character(s) as PNG into a ZIP?\n\nDuplicate names: ${policyLabel}.`
    );
    if (!confirmed) {
        exportInProgress = false;
        return;
    }

    el('export-cards-btn')?.classList.add('disabled');
    $('#export-cards-cancel-btn').show();
    showLogButton('export-cards', null);
    setStatus('export-cards', '');

    setStatus('export-cards', 'Loading ZIP library...');
    if (!await loadJSZip()) {
        toastr.error('Failed to load JSZip. Check internet connection.');
        resetExportUI();
        setStatus('export-cards', 'Error: failed to load ZIP library.', true);
        return;
    }

    const zip   = new JSZip();
    const total = characters.length;
    let exported = 0, skipped = 0, failed = 0;
    const usedNames = new Set();
    const errors    = [];

    for (let i = 0; i < total; i++) {
        if (abortExport) {
            toastr.warning(`Export cancelled. ${exported}/${total} exported.`);
            break;
        }

        const char     = characters[i];
        const charName = char.name || 'unnamed';

        if (!char.avatar) {
            errors.push(`${charName}: no avatar URL`);
            failed++;
            continue;
        }

        const sanitized  = safeName(charName);
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
            // FIX: резервируем имя только для реально существующих файлов.
            // Провалившийся персонаж не занимает слот — следующий тёзка получит оригинальное имя.
            // (Убран usedNames.add здесь — счётчики будут корректны)
        }

        if (i < total - 1) await new Promise(r => setTimeout(r, 80));
    }

    if (abortExport && exported === 0) {
        resetExportUI();
        setStatus('export-cards', 'Export cancelled.');
        return;
    }

    if (exported === 0) {
        toastr.error('No characters exported. Check console (F12).');
        showLogButton('export-cards', errors);
        resetExportUI();
        setStatus('export-cards', 'Error: nothing exported.', true);
        return;
    }

    if (errors.length > 0) {
        zip.file('_export_errors.txt', errors.join('\n'));
        console.warn(`[${MODULE_NAME}] Export errors:`, errors);
    }

    // FIX: убран setProgress('export-cards', 0, total) перед generateAsync —
    //      бар больше не прыгает с 100% обратно в 0%.
    setStatus('export-cards', 'Generating ZIP...');

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
        resetExportUI();
        setStatus('export-cards', 'Error: ZIP generation failed.', true);
        return;
    }

    const ts     = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, -5);
    const sizeMB = (zipBlob.size / 1024 / 1024).toFixed(1);
    await downloadBlob(zipBlob, `all_characters_${ts}.zip`);

    const doneMsg = `Done. ${exported} exported${failed > 0 ? `, ${failed} failed` : ''}${skipped > 0 ? `, ${skipped} skipped` : ''}.`;
    let toastrMsg = `Exported ${exported}/${total} character(s). ZIP: ${sizeMB} MB.`;
    if (skipped > 0) toastrMsg += ` ${skipped} skipped.`;
    if (failed  > 0) toastrMsg += ` ${failed} failed.`;
    toastr.success(toastrMsg);

    // FIX: сначала resetExportUI (сбрасывает флаги/кнопки), затем setStatus —
    //      иначе resetExportUI затирал бы только что выставленный статус.
    showLogButton('export-cards', errors.length > 0 ? errors : null);
    resetExportUI();
    setStatus('export-cards', doneMsg);
}

// ═══════════════════════════════════
// ─── ИМПОРТ ───
// ═══════════════════════════════════
async function importFromZip(file) {
    // FIX: importInProgress = true сразу — нет race condition при двойном вызове.
    if (importInProgress) return;
    importInProgress = true;
    abortImport = false;

    if (!file?.name.toLowerCase().endsWith('.zip')) {
        toastr.warning('Please select a .zip file.');
        importInProgress = false;
        return;
    }

    el('import-cards-btn')?.classList.add('disabled');
    $('#import-cards-cancel-btn').show();
    showLogButton('import-cards', null);
    setStatus('import-cards', '');

    // FIX: OOM-защита — предупреждаем если архив очень большой.
    //      На слабых устройствах (Android/Termux) file.arrayBuffer() может упасть без ошибки.
    if (file.size > MAX_ZIP_WARN_MB * 1024 * 1024) {
        const sizeMB = (file.size / 1024 / 1024).toFixed(0);
        const ok = await showConfirm(
            'Large archive',
            `This ZIP is ${sizeMB} MB.\nLoading it may use a lot of RAM and slow down the device.\n\nContinue?`
        );
        if (!ok) {
            resetImportUI();
            setStatus('import-cards', '');
            return;
        }
    }

    setStatus('import-cards', 'Loading ZIP library...');
    if (!await loadJSZip()) {
        toastr.error('Failed to load JSZip. Check internet connection.');
        resetImportUI();
        setStatus('import-cards', 'Error: failed to load ZIP library.', true);
        return;
    }

    let zip;
    try {
        setStatus('import-cards', 'Reading ZIP...');
        zip = await JSZip.loadAsync(await file.arrayBuffer());
    } catch (e) {
        console.error(`[${MODULE_NAME}] Read ZIP failed:`, e);
        toastr.error('Failed to read ZIP. Is it a valid archive?');
        resetImportUI();
        setStatus('import-cards', 'Error: failed to read ZIP.', true);
        return;
    }

    const pngFiles = Object.entries(zip.files).filter(
        ([name, entry]) =>
            !entry.dir &&
            name.toLowerCase().endsWith('.png') &&
            !name.startsWith('__MACOSX')
    );

    if (pngFiles.length === 0) {
        toastr.warning('No PNG files found in ZIP.');
        resetImportUI();
        setStatus('import-cards', 'No PNG files found.');
        return;
    }

    // ─── Сбор существующих имён для проверки дублей ───
    const ctx = SillyTavern.getContext();
    const existingNames = new Set(
        (ctx?.characters || []).map(c => (c.name || '').toLowerCase().trim())
    );

    // ─── Подсчёт дублей для информирования ───
    const duplicatePolicy = el('import-cards-duplicate-policy')?.value || 'rename';
    const duplicateCount  = pngFiles.filter(([name]) => {
        const charName = name.split('/').pop().replace(/\.png$/i, '').toLowerCase().trim();
        return existingNames.has(charName);
    }).length;

    let confirmMsg = `Found ${pngFiles.length} PNG file(s) in the archive.`;
    if (duplicateCount > 0) {
        const policyLabel = {
            rename: 'auto-rename',
            skip:   'skip',
            anyway: 'import anyway (creates duplicate)',
        };
        confirmMsg += `\n\n${duplicateCount} name conflict(s) found.\nPolicy: ${policyLabel[duplicatePolicy] || duplicatePolicy}.`;
    }
    confirmMsg += '\n\nProceed with import?';

    if (!await showConfirm('Import characters', confirmMsg)) {
        resetImportUI();
        setStatus('import-cards', '');
        return;
    }

    const total = pngFiles.length;
    let imported = 0, skipped = 0, failed = 0;
    const usedNames = new Set(existingNames);
    const errors    = [];

    for (let i = 0; i < total; i++) {
        if (abortImport) {
            toastr.warning(`Import cancelled. ${imported}/${total} imported.`);
            break;
        }

        const [fullPath, entry] = pngFiles[i];
        const filename      = fullPath.split('/').pop();
        const charName      = filename.replace(/\.png$/i, '').trim();
        const charNameLower = charName.toLowerCase();
        const sanitized     = safeName(charName);

        setProgress('import-cards', i + 1, total);
        setStatus('import-cards', `Importing ${i + 1}/${total}: ${charName}`);

        // ─── Проверка дубля ───
        if (existingNames.has(charNameLower) && duplicatePolicy === 'skip') {
            errors.push(`${charName}: skipped (already exists)`);
            skipped++;
            continue;
        }

        // ─── Чтение файла из ZIP ───
        let blob;
        try {
            blob = new Blob([await entry.async('arraybuffer')], { type: 'image/png' });
        } catch (e) {
            errors.push(`${charName}: failed to read from ZIP`);
            failed++;
            continue;
        }

        // FIX: маленький файл — это ошибка чтения, не «пропуск по политике».
        //      Было skipped++, теперь failed++ — счётчики и логи корректны.
        if (!blob || blob.size < 100) {
            errors.push(`${charName}: file too small or empty (${blob?.size ?? 0} bytes)`);
            failed++;
            continue;
        }

        // ─── Определяем финальное имя файла ───
        let importFilename = filename;
        if (duplicatePolicy === 'rename' && existingNames.has(charNameLower)) {
            // FIX: для rename используем safeName(charName) как базу — консистентно с usedNames.
            const newName  = getUniqueName(usedNames, sanitized);
            importFilename = `${newName}.png`;
        } else {
            // FIX: резервируем имя только если файл реально будет импортирован.
            //      Ранее имя добавлялось здесь, до проверки result.ok — если импорт падал,
            //      следующий тёзка получал суффикс (2) хотя первый не был создан.
            usedNames.add(charNameLower);
        }

        const result = await importCharacterPng(importFilename, blob);
        if (result.ok) {
            imported++;
            existingNames.add(charNameLower);
        } else {
            // FIX: имя не было создано — убираем из usedNames чтобы следующий тёзка мог занять слот.
            usedNames.delete(charNameLower);
            errors.push(`${charName}: ${result.reason}`);
            failed++;
        }

        if (i < total - 1) await new Promise(r => setTimeout(r, 100));
    }

    // ─── Обновляем список персонажей в UI ───
    // FIX: исправлен ключ ctx2.event → ctx2.event_types
    //      В getContext() поле называется event_types, не event.
    //      Раньше условие было всегда false → список не обновлялся без F5.
    if (imported > 0) {
        try {
            const ctx2 = SillyTavern.getContext();
            if (ctx2?.eventSource && ctx2?.event_types?.CHARACTER_PAGE_LOADED) {
                await ctx2.eventSource.emit(ctx2.event_types.CHARACTER_PAGE_LOADED);
            }
        } catch (e) {
            console.warn(`[${MODULE_NAME}] Could not refresh character list:`, e);
        }
    }

    if (errors.length > 0) console.warn(`[${MODULE_NAME}] Import errors:`, errors);

    const doneMsg = `Done. ${imported} imported${skipped > 0 ? `, ${skipped} skipped` : ''}${failed > 0 ? `, ${failed} failed` : ''}.`;
    let toastrMsg = `Imported ${imported}/${total} character(s).`;
    if (skipped > 0) toastrMsg += ` ${skipped} skipped.`;
    if (failed  > 0) toastrMsg += ` ${failed} failed.`;

    if (imported > 0)     toastr.success(toastrMsg);
    else if (failed > 0)  toastr.error(toastrMsg);
    else                  toastr.warning(toastrMsg);

    showLogButton('import-cards', errors.length > 0 ? errors : null);
    resetImportUI();
    // FIX: setStatus ПОСЛЕ resetImportUI — иначе reset затирал бы статус.
    setStatus('import-cards', doneMsg, failed > 0 && imported === 0);
}

// ═══════════════════════════════════
// ─── UI ───
// ═══════════════════════════════════
function createUI() {
    // FIX: защита от двойной вставки при горячей перезагрузке расширения.
    //      Одинаковые id в DOM → undefined behavior.
    $('#export-cards-settings').remove();

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

                    <!-- FIX: добавлены MIME-типы zip — файловые менеджеры Android
                         иногда не распознают .zip по расширению -->
                    <input type="file" id="import-cards-file-input"
                        accept=".zip,application/zip,application/x-zip-compressed"
                        style="display:none;">
                </div>
            </div>
        </div>
    `;

    $('#extensions_settings2').append(html);

    // ── Export ──
    // Все обработчики через jQuery — унифицировано (было смешение jQuery + нативный DOM).
    $('#export-cards-btn').on('click', async function () {
        if ($(this).hasClass('disabled')) return;
        await exportAllAsZip();
    });

    $('#export-cards-cancel-btn').on('click', () => {
        abortExport = true;
        $('#export-cards-cancel-btn').hide();
        // FIX: честный статус — операция не обрывается мгновенно,
        //      текущий fetch ещё выполняется.
        setStatus('export-cards', 'Cancelling... (finishing current)');
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
        $('#import-cards-file-input')[0].click();
    });

    $('#import-cards-file-input').on('change', async function () {
        const file = this.files[0];
        if (file) await importFromZip(file);
    });

    $('#import-cards-cancel-btn').on('click', () => {
        abortImport = true;
        $('#import-cards-cancel-btn').hide();
        setStatus('import-cards', 'Cancelling... (finishing current)');
    });

    $('#import-cards-log-btn').on('click', function () {
        const log = this.dataset.log;
        if (log) {
            const ts = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, -5);
            downloadText(log, `import_log_${ts}.txt`);
        }
    });
}

// ═══════════════════════════════════
// ─── Инициализация ───
// ═══════════════════════════════════
// FIX: createUI вызывается только после APP_READY —
//      гарантирует что #extensions_settings2 уже в DOM.
//      На медленных устройствах (Termux, слабые Android) ST грузится дольше.
(function init() {
    try {
        const { eventSource, event_types } = SillyTavern.getContext();
        eventSource.on(event_types.APP_READY, () => {
            createUI();
            console.log(`[${MODULE_NAME}] Extension loaded (v1.4).`);
        });
    } catch (e) {
        // Fallback: если getContext недоступен при старте — вставляем сразу
        console.warn(`[${MODULE_NAME}] APP_READY fallback:`, e);
        createUI();
        console.log(`[${MODULE_NAME}] Extension loaded (v1.4, fallback init).`);
    }
})();
