// ZIP Character Backup v1.9
const MODULE_NAME = 'zip_character_backup';

let abortExport      = false;
let abortImport      = false;
let jsZipLoaded      = false;
let jsZipLoadPromise = null;
let exportInProgress = false;
let importInProgress = false;

const MAX_ZIP_WARN_MB = 200;

// ═══════════════════════════════════════════════════════════
// ─── i18n ───────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════

// Язык читается лениво — при первом обращении к t().
// Это важно: IS_RU не должен вычисляться на уровне модуля,
// потому что скрипт загружается ДО того как ST запишет язык
// в localStorage (APP_READY ещё не случился).
let _isRu = null;
function getIsRu() {
    if (_isRu !== null) return _isRu;
    const lang = (
        localStorage.getItem('language')
        || document.documentElement.lang
        || navigator.language
        || 'en'
    ).toLowerCase();
    _isRu = lang.startsWith('ru');
    return _isRu;
}

const STRINGS = {
    // ── Заголовок панели ──
    panelTitle:             { en: 'ZIP Character Backup', ru: 'ZIP Бэкап персонажей' },

    // ── Секции ──
    sectionExport:          { en: 'Export', ru: 'Экспорт' },
    sectionImport:          { en: 'Import', ru: 'Импорт' },

    // ── Политика дублей ──
    onDuplicate:            { en: 'On duplicate:', ru: 'Дубли:' },
    policyRename:           { en: 'Auto-rename', ru: 'Переименовать' },
    policySkip:             { en: 'Skip', ru: 'Пропустить' },
    policyAnyway:           { en: 'Import anyway', ru: 'Импортировать всё равно' },
    hintPolicyRenameExport: { en: 'Duplicate names get a (2), (3)… suffix', ru: 'Дублям добавляется суффикс (2), (3)…' },
    hintPolicySkipExport:   { en: 'Duplicate names are skipped entirely', ru: 'Дубли имён пропускаются' },
    hintPolicyRenameImport: { en: 'Duplicates are renamed automatically', ru: 'Дубли переименовываются автоматически' },
    hintPolicySkipImport:   { en: 'Existing characters are not overwritten', ru: 'Существующие персонажи не перезаписываются' },
    hintPolicyAnyway:       { en: 'Always import, creates duplicate entries', ru: 'Импортировать всегда, создавая дубли' },

    // ── Кнопки ──
    btnExport:              { en: 'Export All as ZIP', ru: 'Экспортировать всё в ZIP' },
    btnCancelExport:        { en: 'Cancel Export', ru: 'Отменить экспорт' },
    btnImport:              { en: 'Import from ZIP', ru: 'Импортировать из ZIP' },
    btnCancelImport:        { en: 'Cancel Import', ru: 'Отменить импорт' },
    btnDownloadExportLog:   { en: 'Download export log', ru: 'Скачать лог экспорта' },
    btnDownloadImportLog:   { en: 'Download import log', ru: 'Скачать лог импорта' },

    // ── Диалоги подтверждения ──
    confirmExportTitle:     { en: 'Export characters', ru: 'Экспорт персонажей' },
    confirmExportBody:      { en: 'Export {0} character(s) as PNG into a ZIP?\n\nDuplicate names: {1}.', ru: 'Экспортировать {0} персонаж(ей) как PNG в ZIP?\n\nДубли: {1}.' },
    policyLabelRename:      { en: 'auto-rename', ru: 'переименование' },
    policyLabelSkip:        { en: 'skip', ru: 'пропуск' },

    confirmImportTitle:     { en: 'Import characters', ru: 'Импорт персонажей' },
    confirmImportBody:      { en: 'Found {0} PNG file(s) in the archive.', ru: 'Найдено {0} PNG файл(ов) в архиве.' },
    confirmImportConflicts: { en: '\n\n{0} name conflict(s) found.\nPolicy: {1}.', ru: '\n\nКонфликтов имён: {0}.\nПолитика: {1}.' },
    confirmImportProceed:   { en: '\n\nProceed with import?', ru: '\n\nПродолжить импорт?' },
    policyLabelAnyway:      { en: 'import anyway (creates duplicate)', ru: 'импорт с дублем' },

    confirmLargeTitle:      { en: 'Large archive', ru: 'Большой архив' },
    confirmLargeBody:       { en: 'This ZIP is {0} MB.\nLoading it may use a lot of RAM and slow down the device.\n\nContinue?', ru: 'Размер ZIP: {0} МБ.\nЗагрузка может занять много памяти и замедлить устройство.\n\nПродолжить?' },

    // ── Статусы ──
    statusLoadingZip:       { en: 'Loading ZIP library…', ru: 'Загрузка библиотеки ZIP…' },
    statusGeneratingZip:    { en: 'Generating ZIP…', ru: 'Создание ZIP…' },
    statusReadingZip:       { en: 'Reading ZIP…', ru: 'Чтение ZIP…' },
    statusExporting:        { en: 'Exporting {0}/{1}: {2}', ru: 'Экспорт {0}/{1}: {2}' },
    statusSkippedDup:       { en: 'Skipped {0}/{1}: {2} (duplicate)', ru: 'Пропущен {0}/{1}: {2} (дубль)' },
    statusImporting:        { en: 'Importing {0}/{1}: {2}', ru: 'Импорт {0}/{1}: {2}' },
    statusCancelling:       { en: 'Cancelling… (finishing current)', ru: 'Отмена… (завершаем текущий)' },
    statusCancelled:        { en: 'Export cancelled.', ru: 'Экспорт отменён.' },
    statusNoPng:            { en: 'No PNG files found.', ru: 'PNG файлы не найдены.' },
    statusErrZipLib:        { en: 'Failed to load ZIP library.', ru: 'Не удалось загрузить ZIP библиотеку.' },
    statusErrZipRead:       { en: 'Failed to read ZIP.', ru: 'Не удалось прочитать ZIP.' },
    statusErrZipGen:        { en: 'ZIP generation failed.', ru: 'Не удалось создать ZIP.' },
    statusErrNothing:       { en: 'Nothing exported.', ru: 'Ничего не экспортировано.' },

    statusDoneExport:       { en: 'Done. {0} exported{1}{2}.', ru: 'Готово. Экспортировано: {0}{1}{2}.' },
    statusDoneExportFailed: { en: ', {0} failed', ru: ', ошибок: {0}' },
    statusDoneExportSkip:   { en: ', {0} skipped', ru: ', пропущено: {0}' },

    statusDoneImport:       { en: 'Done. {0} imported{1}{2}.', ru: 'Готово. Импортировано: {0}{1}{2}.' },
    statusDoneImportFailed: { en: ', {0} failed', ru: ', ошибок: {0}' },
    statusDoneImportSkip:   { en: ', {0} skipped', ru: ', пропущено: {0}' },

    // ── Toastr ──
    toastrNoChars:          { en: 'No characters found.', ru: 'Персонажи не найдены.' },
    toastrSelectZip:        { en: 'Please select a .zip file.', ru: 'Выберите .zip файл.' },
    toastrNoPng:            { en: 'No PNG files found in ZIP.', ru: 'В ZIP нет PNG файлов.' },
    toastrZipLibFail:       { en: 'Failed to load JSZip. Check internet connection.', ru: 'Не удалось загрузить JSZip. Проверьте интернет-соединение.' },
    toastrZipReadFail:      { en: 'Failed to read ZIP. Is it a valid archive?', ru: 'Не удалось прочитать ZIP. Это корректный архив?' },
    toastrZipGenFail:       { en: 'Failed to generate ZIP.', ru: 'Не удалось создать ZIP.' },
    toastrNothingExported:  { en: 'No characters exported. Check console (F12).', ru: 'Ничего не экспортировано. Проверьте консоль (F12).' },
    toastrExportDone:       { en: 'Exported {0}/{1} character(s). ZIP: {2} MB.', ru: 'Экспортировано {0}/{1} персонаж(ей). ZIP: {2} МБ.' },
    toastrExportSkipped:    { en: ' {0} skipped.', ru: ' Пропущено: {0}.' },
    toastrExportFailed:     { en: ' {0} failed.', ru: ' Ошибок: {0}.' },
    toastrImportDone:       { en: 'Imported {0}/{1} character(s).', ru: 'Импортировано {0}/{1} персонаж(ей).' },
    toastrImportSkipped:    { en: ' {0} skipped.', ru: ' Пропущено: {0}.' },
    toastrImportFailed:     { en: ' {0} failed.', ru: ' Ошибок: {0}.' },
    toastrCancelledExport:  { en: 'Export cancelled. {0}/{1} exported.', ru: 'Экспорт отменён. Экспортировано {0}/{1}.' },
    toastrCancelledImport:  { en: 'Import cancelled. {0}/{1} imported.', ru: 'Импорт отменён. Импортировано {0}/{1}.' },

    // ── Имя файла для импорта ──
    fileSelected:           { en: '📦 {0}', ru: '📦 {0}' },
    fileNone:               { en: '', ru: '' },

    // ── Ошибки в лог ──
    errNoAvatar:            { en: '{0}: no avatar (avatar field is empty or "none")', ru: '{0}: нет аватара (поле avatar пустое или "none")' },
    errExportFailed:        { en: '{0}: export failed', ru: '{0}: ошибка экспорта' },
    errSkippedDup:          { en: '{0}: skipped (duplicate name)', ru: '{0}: пропущен (дубль имени)' },
    errReadZip:             { en: '{0}: failed to read from ZIP', ru: '{0}: не удалось прочитать из ZIP' },
    errTooSmall:            { en: '{0}: file too small or empty ({1} bytes)', ru: '{0}: файл слишком мал или пуст ({1} байт)' },
    errAlreadyExists:       { en: '{0}: skipped (already exists)', ru: '{0}: пропущен (уже существует)' },
};

function t(key, ...args) {
    const entry = STRINGS[key];
    if (!entry) {
        console.warn(`[${MODULE_NAME}] Missing i18n key: "${key}"`);
        return key;
    }
    const isRu = getIsRu();
    let str = isRu ? (entry.ru || entry.en) : entry.en;
    return str.replace(/\{(\d+)\}/g, (_, i) => args[i] ?? '');
}

// ═══════════════════════════════════════════════════════════
// ─── Настройки (extensionSettings) ──────────────────────────
// ═══════════════════════════════════════════════════════════
function getSettings() {
    const ctx = SillyTavern.getContext();
    if (!ctx.extensionSettings[MODULE_NAME]) {
        ctx.extensionSettings[MODULE_NAME] = {};
    }
    return ctx.extensionSettings[MODULE_NAME];
}

function saveSettings() {
    SillyTavern.getContext().saveSettingsDebounced();
}

// ═══════════════════════════════════════════════════════════
// ─── JSZip ──────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════
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

        script.onload  = () => { clearTimeout(timer); jsZipLoaded = true; resolve(true); };
        script.onerror = () => { clearTimeout(timer); console.error(`[${MODULE_NAME}] Failed to load JSZip`); resolve(false); };
        document.head.appendChild(script);
    }).finally(() => { jsZipLoadPromise = null; });

    return jsZipLoadPromise;
}

// ═══════════════════════════════════════════════════════════
// ─── Заголовки ST ───────────────────────────────────────────
// ═══════════════════════════════════════════════════════════
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

// ═══════════════════════════════════════════════════════════
// ─── Утилиты ────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════
function safeName(name) {
    return name.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').replace(/\s+/g, ' ').trim() || 'unnamed';
}

async function showConfirm(title, text) {
    try {
        const ctx = SillyTavern.getContext();
        if (typeof ctx?.Popup?.show?.confirm === 'function') {
            return await ctx.Popup.show.confirm(title, text);
        }
    } catch (e) {
        console.warn(`[${MODULE_NAME}] Popup fallback:`, e);
    }
    return confirm(`${title}\n\n${text}`);
}

// ═══════════════════════════════════════════════════════════
// ─── UI helpers ─────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════
function el(id) { return document.getElementById(id); }

function setStatus(prefix, text, state = 'idle') {
    const wrap = el(`${prefix}-status`);
    if (!wrap) return;

    const iconEl = wrap.querySelector('.export-cards-status-icon');
    const textEl = wrap.querySelector('.export-cards-status-text');
    if (!iconEl || !textEl) return;

    const icons = {
        idle:             '',
        running:          'fa-solid fa-spinner spinning',
        'running-import': 'fa-solid fa-spinner spinning',
        success:          'fa-solid fa-check',
        error:            'fa-solid fa-circle-exclamation',
        warning:          'fa-solid fa-triangle-exclamation',
        cancel:           'fa-solid fa-ban',
    };

    wrap.dataset.state = state;
    iconEl.className = `export-cards-status-icon ${icons[state] || ''}`;
    textEl.textContent = text;
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
        const countEl = btn.querySelector('.export-cards-log-count');
        if (countEl) countEl.textContent = `(${errors.length} error${errors.length > 1 ? 's' : ''})`;
    } else {
        btn.style.display = 'none';
    }
}

function setFilename(filename) {
    const el2 = el('import-cards-filename');
    if (!el2) return;
    el2.textContent = filename ? t('fileSelected', filename) : '';
}

// ─── Подсказка для политики дублей ──────────────────────────
function updatePolicyHint(prefix) {
    const select = el(`${prefix}-duplicate-policy`);
    const hint   = el(`${prefix}-policy-hint`);
    if (!select || !hint) return;

    const hintKeys = {
        'export-cards': {
            rename: 'hintPolicyRenameExport',
            skip:   'hintPolicySkipExport',
        },
        'import-cards': {
            rename: 'hintPolicyRenameImport',
            skip:   'hintPolicySkipImport',
            anyway: 'hintPolicyAnyway',
        },
    };
    const key = hintKeys[prefix]?.[select.value];
    hint.textContent = key ? t(key) : '';
}

// ─── Скачивание файлов ──────────────────────────────────────
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
        reader.onerror = () => resolve();
        reader.readAsDataURL(blob);
    });
}

const isMobileChromium = /Android.*Chrome|Chrome.*Android/i.test(navigator.userAgent);

async function downloadBlob(blob, filename) {
    if (isMobileChromium) {
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
    await downloadBlob(new Blob([text], { type: 'text/plain;charset=utf-8' }), filename);
}

// ─── Сброс UI ───────────────────────────────────────────────
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
}

function resetImportUI() {
    importInProgress = false;
    abortImport      = false;
    // Восстанавливаем связь label↔input
    const btn = el('import-cards-btn');
    if (btn) {
        btn.classList.remove('disabled');
        btn.setAttribute('for', 'import-cards-file-input');
    }
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
    setFilename(null);
}

// ─── Уникальное имя ─────────────────────────────────────────
function getUniqueName(usedNames, baseName) {
    let name = baseName;
    let i = 2;
    while (usedNames.has(name.toLowerCase())) name = `${baseName} (${i++})`;
    usedNames.add(name.toLowerCase());
    return name;
}

// ═══════════════════════════════════════════════════════════
// ─── API: экспорт одного персонажа ──────────────────────────
// ═══════════════════════════════════════════════════════════
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

// ═══════════════════════════════════════════════════════════
// ─── API: импорт одного PNG ──────────────────────────────────
// ═══════════════════════════════════════════════════════════
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

// ═══════════════════════════════════════════════════════════
// ─── ЭКСПОРТ ────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════
async function exportAllAsZip() {
    if (exportInProgress) return;
    exportInProgress = true;
    abortExport = false;

    const ctx        = SillyTavern.getContext();
    const characters = ctx?.characters;
    if (!characters || characters.length === 0) {
        toastr.warning(t('toastrNoChars'));
        exportInProgress = false;
        return;
    }

    const duplicatePolicy = el('export-cards-duplicate-policy')?.value || 'rename';
    const policyLabel     = duplicatePolicy === 'rename' ? t('policyLabelRename') : t('policyLabelSkip');
    const confirmed = await showConfirm(
        t('confirmExportTitle'),
        t('confirmExportBody', characters.length, policyLabel)
    );
    if (!confirmed) { exportInProgress = false; return; }

    el('export-cards-btn')?.classList.add('disabled');
    $('#export-cards-cancel-btn').show();
    showLogButton('export-cards', null);
    setStatus('export-cards', '', 'idle');

    setStatus('export-cards', t('statusLoadingZip'), 'running');
    if (!await loadJSZip()) {
        toastr.error(t('toastrZipLibFail'));
        resetExportUI();
        setStatus('export-cards', t('statusErrZipLib'), 'error');
        return;
    }

    const zip   = new JSZip();
    const total = characters.length;
    let exported = 0, skipped = 0, failed = 0;
    const usedNames = new Set();
    const errors    = [];

    for (let i = 0; i < total; i++) {
        if (abortExport) {
            toastr.warning(t('toastrCancelledExport', exported, total));
            break;
        }

        const char     = characters[i];
        const charName = char.name || 'unnamed';

        // char.avatar === 'none' — специальное значение ST когда аватар не задан
        if (!char.avatar || char.avatar === 'none') {
            errors.push(t('errNoAvatar', charName));
            failed++;
            continue;
        }

        const sanitized   = safeName(charName);
        const isDuplicate = usedNames.has(sanitized.toLowerCase());

        if (isDuplicate && duplicatePolicy === 'skip') {
            errors.push(t('errSkippedDup', charName));
            skipped++;
            setProgress('export-cards', i + 1, total);
            setStatus('export-cards', t('statusSkippedDup', i + 1, total, charName), 'running');
            continue;
        }

        setProgress('export-cards', i + 1, total);
        setStatus('export-cards', t('statusExporting', i + 1, total, charName), 'running');

        const blob = await fetchCharacterPng(char.avatar);
        if (blob) {
            const uniqueName = getUniqueName(usedNames, sanitized);
            zip.file(`${uniqueName}.png`, blob);
            exported++;
        } else {
            errors.push(t('errExportFailed', charName));
            failed++;
        }

        if (i < total - 1) await new Promise(r => setTimeout(r, 80));
    }

    if (abortExport && exported === 0) {
        resetExportUI();
        setStatus('export-cards', t('statusCancelled'), 'cancel');
        return;
    }

    if (exported === 0) {
        toastr.error(t('toastrNothingExported'));
        showLogButton('export-cards', errors);
        resetExportUI();
        setStatus('export-cards', t('statusErrNothing'), 'error');
        return;
    }

    if (errors.length > 0) {
        zip.file('_export_errors.txt', errors.join('\n'));
        console.warn(`[${MODULE_NAME}] Export errors:`, errors);
    }

    setStatus('export-cards', t('statusGeneratingZip'), 'running');

    let zipBlob;
    try {
        zipBlob = await zip.generateAsync(
            { type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } },
            (meta) => setProgress('export-cards', Math.round(meta.percent * total / 100), total)
        );
    } catch (e) {
        console.error(`[${MODULE_NAME}] ZIP generation failed:`, e);
        toastr.error(t('toastrZipGenFail'));
        showLogButton('export-cards', errors);
        resetExportUI();
        setStatus('export-cards', t('statusErrZipGen'), 'error');
        return;
    }

    const ts     = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, -5);
    const sizeMB = (zipBlob.size / 1024 / 1024).toFixed(1);
    await downloadBlob(zipBlob, `characters_backup_${ts}.zip`);

    const failedPart  = failed  > 0 ? t('statusDoneExportFailed', failed)  : '';
    const skippedPart = skipped > 0 ? t('statusDoneExportSkip',   skipped) : '';
    const doneMsg     = t('statusDoneExport', exported, failedPart, skippedPart);

    let toastrMsg = t('toastrExportDone', exported, total, sizeMB);
    if (skipped > 0) toastrMsg += t('toastrExportSkipped', skipped);
    if (failed  > 0) toastrMsg += t('toastrExportFailed',  failed);
    toastr.success(toastrMsg);

    showLogButton('export-cards', errors.length > 0 ? errors : null);
    resetExportUI();
    setStatus('export-cards', doneMsg, failed > 0 ? 'warning' : 'success');
}

// ═══════════════════════════════════════════════════════════
// ─── ИМПОРТ ─────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════
async function importFromZip(file) {
    if (importInProgress) return;
    importInProgress = true;
    abortImport = false;

    if (!file?.name.toLowerCase().endsWith('.zip')) {
        toastr.warning(t('toastrSelectZip'));
        importInProgress = false;
        return;
    }

    setFilename(file.name);

    // Блокируем label — убираем связь с input чтобы повторный тап не открыл файловый диалог
    const importBtn = el('import-cards-btn');
    if (importBtn) {
        importBtn.classList.add('disabled');
        importBtn.removeAttribute('for');
    }
    $('#import-cards-cancel-btn').show();
    showLogButton('import-cards', null);
    setStatus('import-cards', '', 'idle');

    if (file.size > MAX_ZIP_WARN_MB * 1024 * 1024) {
        const sizeMB = (file.size / 1024 / 1024).toFixed(0);
        const ok = await showConfirm(t('confirmLargeTitle'), t('confirmLargeBody', sizeMB));
        if (!ok) {
            resetImportUI();
            setStatus('import-cards', '', 'idle');
            return;
        }
    }

    setStatus('import-cards', t('statusLoadingZip'), 'running-import');
    if (!await loadJSZip()) {
        toastr.error(t('toastrZipLibFail'));
        resetImportUI();
        setStatus('import-cards', t('statusErrZipLib'), 'error');
        return;
    }

    let zip;
    try {
        setStatus('import-cards', t('statusReadingZip'), 'running-import');
        zip = await JSZip.loadAsync(await file.arrayBuffer());
    } catch (e) {
        console.error(`[${MODULE_NAME}] Read ZIP failed:`, e);
        toastr.error(t('toastrZipReadFail'));
        resetImportUI();
        setStatus('import-cards', t('statusErrZipRead'), 'error');
        return;
    }

    const pngFiles = Object.entries(zip.files).filter(
        ([name, entry]) =>
            !entry.dir &&
            name.toLowerCase().endsWith('.png') &&
            !name.startsWith('__MACOSX')
    );

    if (pngFiles.length === 0) {
        toastr.warning(t('toastrNoPng'));
        resetImportUI();
        setStatus('import-cards', t('statusNoPng'), 'warning');
        return;
    }

    const ctx = SillyTavern.getContext();
    const existingNames = new Set(
        (ctx?.characters || []).map(c => (c.name || '').toLowerCase().trim())
    );

    const duplicatePolicy = el('import-cards-duplicate-policy')?.value || 'rename';
    const duplicateCount  = pngFiles.filter(([name]) => {
        const charName = name.split('/').pop().replace(/\.png$/i, '').toLowerCase().trim();
        return existingNames.has(charName);
    }).length;

    const policyLabels = {
        rename: t('policyLabelRename'),
        skip:   t('policyLabelSkip'),
        anyway: t('policyLabelAnyway'),
    };

    let confirmMsg = t('confirmImportBody', pngFiles.length);
    if (duplicateCount > 0) {
        confirmMsg += t('confirmImportConflicts', duplicateCount, policyLabels[duplicatePolicy] || duplicatePolicy);
    }
    confirmMsg += t('confirmImportProceed');

    if (!await showConfirm(t('confirmImportTitle'), confirmMsg)) {
        resetImportUI();
        setStatus('import-cards', '', 'idle');
        return;
    }

    const total = pngFiles.length;
    let imported = 0, skipped = 0, failed = 0;
    const usedNames = new Set(existingNames);
    const errors    = [];

    for (let i = 0; i < total; i++) {
        if (abortImport) {
            toastr.warning(t('toastrCancelledImport', imported, total));
            break;
        }

        const [fullPath, entry] = pngFiles[i];
        const filename      = fullPath.split('/').pop();
        const charName      = filename.replace(/\.png$/i, '').trim();
        const charNameLower = charName.toLowerCase();
        const sanitized     = safeName(charName);

        setProgress('import-cards', i + 1, total);
        setStatus('import-cards', t('statusImporting', i + 1, total, charName), 'running-import');

        if (existingNames.has(charNameLower) && duplicatePolicy === 'skip') {
            errors.push(t('errAlreadyExists', charName));
            skipped++;
            continue;
        }

        let blob;
        try {
            blob = new Blob([await entry.async('arraybuffer')], { type: 'image/png' });
        } catch (e) {
            errors.push(t('errReadZip', charName));
            failed++;
            continue;
        }

        if (!blob || blob.size < 100) {
            errors.push(t('errTooSmall', charName, blob?.size ?? 0));
            failed++;
            continue;
        }

        let importFilename = filename;
        if (duplicatePolicy === 'rename' && existingNames.has(charNameLower)) {
            const newName  = getUniqueName(usedNames, sanitized);
            importFilename = `${newName}.png`;
        } else {
            usedNames.add(charNameLower);
        }

        const result = await importCharacterPng(importFilename, blob);
        if (result.ok) {
            imported++;
            existingNames.add(charNameLower);
        } else {
            usedNames.delete(charNameLower);
            errors.push(`${charName}: ${result.reason}`);
            failed++;
        }

        if (i < total - 1) await new Promise(r => setTimeout(r, 100));
    }

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

    const failedPart  = failed  > 0 ? t('statusDoneImportFailed', failed)  : '';
    const skippedPart = skipped > 0 ? t('statusDoneImportSkip',   skipped) : '';
    const doneMsg     = t('statusDoneImport', imported, failedPart, skippedPart);

    let toastrMsg = t('toastrImportDone', imported, total);
    if (skipped > 0) toastrMsg += t('toastrImportSkipped', skipped);
    if (failed  > 0) toastrMsg += t('toastrImportFailed',  failed);

    if (imported > 0)    toastr.success(toastrMsg);
    else if (failed > 0) toastr.error(toastrMsg);
    else                 toastr.warning(toastrMsg);

    showLogButton('import-cards', errors.length > 0 ? errors : null);
    resetImportUI();

    const finalState = failed > 0 && imported === 0 ? 'error'
                     : failed > 0                   ? 'warning'
                     : 'success';
    setStatus('import-cards', doneMsg, finalState);
}

// ═══════════════════════════════════════════════════════════
// ─── UI ─────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════
function createUI() {
    $('#export-cards-settings').remove();

    // Читаем сохранённое состояние drawer (по умолчанию — открыт)
    const settings   = getSettings();
    const drawerOpen = settings.drawerOpen !== false; // undefined → true
    const iconClass  = drawerOpen ? 'fa-circle-chevron-up up' : 'fa-circle-chevron-down down';
    const contentStyle = drawerOpen ? '' : 'style="display:none;"';

    const html = `
        <div id="export-cards-settings">
            <div class="inline-drawer">
                <div class="inline-drawer-toggle inline-drawer-header">
                    <b>${t('panelTitle')}</b>
                    <div class="inline-drawer-icon fa-solid ${iconClass}"></div>
                </div>
                <div class="inline-drawer-content" ${contentStyle}>

                    <!-- ══ EXPORT ══ -->
                    <div class="export-cards-section">
                        <div class="export-cards-section-header">
                            <i class="fa-solid fa-box-archive"></i>
                            <span class="export-cards-section-label">${t('sectionExport')}</span>
                        </div>

                        <div class="export-cards-policy-row">
                            <label for="export-cards-duplicate-policy">${t('onDuplicate')}</label>
                            <select id="export-cards-duplicate-policy">
                                <option value="rename">${t('policyRename')}</option>
                                <option value="skip">${t('policySkip')}</option>
                            </select>
                        </div>
                        <div id="export-cards-policy-hint" class="export-cards-policy-hint"></div>

                        <div id="export-cards-btn" class="menu_button">
                            <i class="fa-solid fa-file-zipper"></i>
                            <span>${t('btnExport')}</span>
                        </div>
                        <div id="export-cards-cancel-btn" class="menu_button export-cards-cancel" style="display:none;">
                            <i class="fa-solid fa-xmark"></i>
                            <span>${t('btnCancelExport')}</span>
                        </div>

                        <div class="export-cards-progress-row" style="display:none;" id="export-cards-progress-bar">
                            <div class="export-cards-bar-wrap">
                                <div id="export-cards-progress-fill" class="export-cards-bar-fill green"></div>
                            </div>
                            <span id="export-cards-progress-counter" class="export-cards-counter"></span>
                        </div>

                        <div id="export-cards-status" class="export-cards-status" data-state="idle">
                            <i class="export-cards-status-icon"></i>
                            <span class="export-cards-status-text"></span>
                        </div>
                        <button id="export-cards-log-btn" class="export-cards-log-btn" style="display:none;">
                            <span class="export-cards-log-dot"></span>
                            ${t('btnDownloadExportLog')} <span class="export-cards-log-count"></span>
                        </button>
                    </div>

                    <div class="export-cards-sections-gap"></div>

                    <!-- ══ IMPORT ══ -->
                    <div class="export-cards-section">
                        <div class="export-cards-section-header">
                            <i class="fa-solid fa-file-import"></i>
                            <span class="export-cards-section-label">${t('sectionImport')}</span>
                        </div>

                        <div class="export-cards-policy-row">
                            <label for="import-cards-duplicate-policy">${t('onDuplicate')}</label>
                            <select id="import-cards-duplicate-policy">
                                <option value="rename">${t('policyRename')}</option>
                                <option value="skip">${t('policySkip')}</option>
                                <option value="anyway">${t('policyAnyway')}</option>
                            </select>
                        </div>
                        <div id="import-cards-policy-hint" class="export-cards-policy-hint"></div>

                        <label id="import-cards-btn" class="menu_button" for="import-cards-file-input">
                            <i class="fa-solid fa-folder-open"></i>
                            <span>${t('btnImport')}</span>
                        </label>
                        <input type="file" id="import-cards-file-input"
                            class="export-cards-file-input-hidden"
                            accept=".zip,application/zip,application/x-zip-compressed">
                        <div id="import-cards-filename" class="export-cards-filename"></div>
                        <div id="import-cards-cancel-btn" class="menu_button export-cards-cancel" style="display:none;">
                            <i class="fa-solid fa-xmark"></i>
                            <span>${t('btnCancelImport')}</span>
                        </div>

                        <div class="export-cards-progress-row" style="display:none;" id="import-cards-progress-bar">
                            <div class="export-cards-bar-wrap">
                                <div id="import-cards-progress-fill" class="export-cards-bar-fill blue"></div>
                            </div>
                            <span id="import-cards-progress-counter" class="export-cards-counter"></span>
                        </div>

                        <div id="import-cards-status" class="export-cards-status" data-state="idle">
                            <i class="export-cards-status-icon"></i>
                            <span class="export-cards-status-text"></span>
                        </div>
                        <button id="import-cards-log-btn" class="export-cards-log-btn" style="display:none;">
                            <span class="export-cards-log-dot"></span>
                            ${t('btnDownloadImportLog')} <span class="export-cards-log-count"></span>
                        </button>
                    </div>

                </div>
            </div>
        </div>
    `;

    $('#extensions_settings2').append(html);

    // Инициализируем подсказки
    updatePolicyHint('export-cards');
    updatePolicyHint('import-cards');

    // ── Сохранение состояния drawer ──────────────────────────
    // ST диспатчит 'inline-drawer-toggle' на элементе .inline-drawer после toggle.
    // Слушаем его и сохраняем состояние в extensionSettings.
    $('#export-cards-settings .inline-drawer').on('inline-drawer-toggle', function () {
        const icon   = this.querySelector('.inline-drawer-icon');
        const isOpen = icon?.classList.contains('up') ?? true;
        const s = getSettings();
        s.drawerOpen = isOpen;
        saveSettings();
    });

    // ── Обработчики ──────────────────────────────────────────
    $('#export-cards-btn').on('click', async function () {
        if ($(this).hasClass('disabled')) return;
        await exportAllAsZip();
    });

    $('#export-cards-cancel-btn').on('click', () => {
        abortExport = true;
        $('#export-cards-cancel-btn').hide();
        setStatus('export-cards', t('statusCancelling'), 'cancel');
    });

    $('#export-cards-duplicate-policy').on('change', () => updatePolicyHint('export-cards'));

    $('#export-cards-log-btn').on('click', function () {
        const log = this.dataset.log;
        if (log) {
            const ts = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, -5);
            downloadText(log, `export_log_${ts}.txt`);
        }
    });

    // Import: label[for] открывает файловый диалог нативно
    $('#import-cards-file-input').on('change', async function () {
        const file = this.files[0];
        if (file) await importFromZip(file);
    });

    $('#import-cards-cancel-btn').on('click', () => {
        abortImport = true;
        $('#import-cards-cancel-btn').hide();
        setStatus('import-cards', t('statusCancelling'), 'cancel');
    });

    $('#import-cards-duplicate-policy').on('change', () => updatePolicyHint('import-cards'));

    $('#import-cards-log-btn').on('click', function () {
        const log = this.dataset.log;
        if (log) {
            const ts = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, -5);
            downloadText(log, `import_log_${ts}.txt`);
        }
    });
}

// ═══════════════════════════════════════════════════════════
// ─── Инициализация ──────────────────────────────────────────
// ═══════════════════════════════════════════════════════════
(function init() {
    try {
        const { eventSource, event_types } = SillyTavern.getContext();
        eventSource.on(event_types.APP_READY, () => {
            createUI();
            console.log(`[${MODULE_NAME}] Extension loaded (v1.9, lang: ${getIsRu() ? 'ru' : 'en'}).`);
        });
    } catch (e) {
        console.warn(`[${MODULE_NAME}] APP_READY fallback:`, e);
        createUI();
        console.log(`[${MODULE_NAME}] Extension loaded (v1.9, fallback init, lang: ${getIsRu() ? 'ru' : 'en'}).`);
    }
})();
