(function () {
    'use strict';

    window.__mcUiSettings = window.__mcUiSettings || {
        weekStart: 'monday',
        debug: undefined,
        defaultEventColor: '',
        defaultEventColorLight: '',
        defaultEventColorDark: '',
        icsExportLinks: [],
        timeFormat: '24h',
    };
    const uiSettings = window.__mcUiSettings;

    const IDS = {
        root: 'mc-event-form-root',
        form: 'mc-event-create-form',
        status: 'mc-event-form-status',
        targetFolder: 'mc-event-target-folder',
        title: 'mc-event-title',
        startDate: 'mc-event-start-date',
        startTime: 'mc-event-start-time',
        endDate: 'mc-event-end-date',
        endTime: 'mc-event-end-time',
        timeZone: 'mc-event-timezone',
        allDay: 'mc-event-all-day',
        color: 'mc-event-color',
        location: 'mc-event-location',
        description: 'mc-event-description',
        repeat: 'mc-event-repeat',
        repeatDetails: 'mc-event-repeat-details',
        repeatInterval: 'mc-event-repeat-interval',
        repeatUntil: 'mc-event-repeat-until',
        monthDay: 'mc-event-month-day',
        excludeDates: 'mc-event-exclude-dates',
        tags: 'mc-event-tags',
        tagsButton: 'mc-event-tags-button',
        tagsDropdown: 'mc-event-tags-dropdown',
        tagsOptions: 'mc-event-tags-options',
    };

    const MAX_VISIBLE_TAG_OPTIONS = 100;

    const LS = {
        targetFolderId: 'mycalendar.eventTargetFolderId',
    };

    const DEFAULT_EVENT_COLOR = '#1470d9';

    const FALLBACK_TIME_ZONES = [
        'UTC',
        'America/Toronto',
        'America/New_York',
        'America/Chicago',
        'America/Denver',
        'America/Los_Angeles',
        'Europe/London',
        'Europe/Berlin',
        'Europe/Kyiv',
        'Asia/Tokyo',
        'Australia/Sydney',
    ];

    const MSG = Object.freeze({
        UI_READY: 'uiReady',
        REQUEST_FOLDERS: 'requestFolders',
        REQUEST_TAGS: 'requestTags',
        UI_SETTINGS: 'uiSettings',
        FOLDERS: 'folders',
        TAGS: 'tags',
        CALENDAR_EVENT_CREATE: 'calendarEventCreate',
        CALENDAR_EVENT_CREATE_DONE: 'calendarEventCreateDone',
        CALENDAR_EVENT_CREATE_ERROR: 'calendarEventCreateError',
    });

    function postToPlugin(message) {
        window.webviewApi?.postMessage?.(message);
    }

    function safeGetLS(key, fallback = '') {
        try {
            const v = localStorage.getItem(key);
            return v == null ? fallback : v;
        } catch {
            return fallback;
        }
    }

    function safeSetLS(key, value) {
        try {
            localStorage.setItem(key, value);
        } catch {
            // ignore
        }
    }

    function normalizeHexColor(value) {
        const raw = String(value || '').trim();
        return /^#[0-9a-fA-F]{6}$/.test(raw) ? raw.toLowerCase() : '';
    }

    function parseColorToRgb(value) {
        const raw = String(value || '').trim();
        const hex = raw.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
        if (hex) {
            const part = hex[1];
            const full = part.length === 3 ? part.split('').map(ch => ch + ch).join('') : part;
            return {
                r: parseInt(full.slice(0, 2), 16),
                g: parseInt(full.slice(2, 4), 16),
                b: parseInt(full.slice(4, 6), 16),
            };
        }
        const rgb = raw.match(/^rgba?\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)/i);
        if (!rgb) return null;
        return {r: Number(rgb[1]), g: Number(rgb[2]), b: Number(rgb[3])};
    }

    function isDarkTheme() {
        const styles = window.getComputedStyle?.(document.documentElement);
        const bodyStyles = window.getComputedStyle?.(document.body);
        const bg = styles?.getPropertyValue('--joplin-background-color') ||
            styles?.backgroundColor ||
            bodyStyles?.backgroundColor ||
            '';
        const rgb = parseColorToRgb(bg);
        if (rgb) {
            const srgb = [rgb.r, rgb.g, rgb.b].map((channel) => {
                const c = Math.max(0, Math.min(255, channel)) / 255;
                return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
            });
            const luminance = (0.2126 * srgb[0]) + (0.7152 * srgb[1]) + (0.0722 * srgb[2]);
            return luminance < 0.5;
        }
        return window.matchMedia?.('(prefers-color-scheme: dark)')?.matches === true;
    }

    function getDefaultEventColor() {
        const color = isDarkTheme() ? uiSettings.defaultEventColorDark : uiSettings.defaultEventColorLight;
        return normalizeHexColor(color) || normalizeHexColor(uiSettings.defaultEventColor) || DEFAULT_EVENT_COLOR;
    }

    function el(tag, attrs = {}, children = []) {
        const n = document.createElement(tag);

        for (const [k, v] of Object.entries(attrs)) {
            if (v === undefined || v === null) continue;

            if (k === 'class') {
                n.className = String(v);
                continue;
            }
            if (k === 'checked') {
                n.checked = Boolean(v);
                if (v) n.setAttribute('checked', 'checked');
                continue;
            }
            if (k === 'disabled') {
                n.disabled = Boolean(v);
                if (v) n.setAttribute('disabled', 'disabled');
                continue;
            }
            if (k === 'value') {
                n.value = String(v);
                continue;
            }
            if (k.startsWith('on') && typeof v === 'function') {
                n.addEventListener(k.slice(2), v);
                continue;
            }

            n.setAttribute(k, String(v));
        }

        for (const c of children) {
            if (c == null) continue;
            if (typeof c === 'string') n.appendChild(document.createTextNode(c));
            else n.appendChild(c);
        }

        return n;
    }

    function createUiLogger(prefix) {
        function isDebugEnabled() {
            return uiSettings.debug === true;
        }

        function forwardToMain(level, args) {
            try {
                if (!isDebugEnabled()) return;
                const pm = window.webviewApi?.postMessage;
                if (typeof pm !== 'function') return;

                const safeArgs = (args || []).map((a) => {
                    if (a && typeof a === 'object' && a.message && a.stack) {
                        return {__error: true, message: a.message, stack: a.stack};
                    }
                    if (typeof a === 'string') return a;
                    try {
                        return JSON.stringify(a);
                    } catch {
                        return String(a);
                    }
                });

                pm({name: 'uiLog', source: 'eventCreate', level, args: safeArgs});
            } catch {
                // ignore
            }
        }

        function write(consoleFn, args) {
            if (args.length > 0 && typeof args[0] === 'string') {
                const [msg, ...rest] = args;
                consoleFn(`${prefix} ${msg}`, ...rest);
            } else {
                consoleFn(prefix, ...args);
            }
        }

        return {
            debug: (...args) => {
                write(console.log, args);
                forwardToMain('debug', args);
            },
            error: (...args) => {
                write(console.error, args);
                forwardToMain('error', args);
            },
        };
    }

    const uiLogger = window.__mcEventCreateLogger || (window.__mcEventCreateLogger = createUiLogger('[MyCalendar Event]'));

    function mcRegisterOnMessage(handler) {
        window.__mcMsgHandlers = window.__mcMsgHandlers || [];
        window.__mcMsgHandlers.push(handler);

        if (window.__mcMsgDispatcherInstalled) return;
        window.__mcMsgDispatcherInstalled = true;

        if (window.webviewApi?.onMessage) {
            window.webviewApi.onMessage((ev) => {
                const msg = ev && ev.message ? ev.message : ev;
                for (const h of window.__mcMsgHandlers) {
                    try {
                        h(msg);
                    } catch (e) {
                        uiLogger.error('handler error', e);
                    }
                }
            });
        }
    }

    function getTimeFormat() {
        return uiSettings.timeFormat === '12h' ? '12h' : '24h';
    }

    function getLocalParts(offsetMinutes) {
        const d = new Date(Date.now() + (offsetMinutes || 0) * 60 * 1000);
        d.setSeconds(0, 0);
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        const h = String(d.getHours()).padStart(2, '0');
        const min = String(d.getMinutes()).padStart(2, '0');
        return {date: `${y}-${m}-${day}`, time: `${h}:${min}`};
    }

    function formatTimeLabel(value) {
        const m = String(value || '').match(/^([0-9]{2}):([0-9]{2})$/);
        if (!m) return String(value || '');
        const hour = Number(m[1]);
        const minute = m[2];
        if (getTimeFormat() === '24h') return `${m[1]}:${minute}`;
        const suffix = hour >= 12 ? 'PM' : 'AM';
        const displayHour = hour % 12 || 12;
        return `${displayHour}:${minute} ${suffix}`;
    }

    function fillTimeSelect(selectEl, selectedValue) {
        const previous = selectedValue || selectEl.value || '09:00';
        selectEl.innerHTML = '';
        for (let total = 0; total < 24 * 60; total += 15) {
            const h = String(Math.floor(total / 60)).padStart(2, '0');
            const m = String(total % 60).padStart(2, '0');
            const value = `${h}:${m}`;
            selectEl.appendChild(el('option', {value}, [formatTimeLabel(value)]));
        }
        selectEl.value = previous;
        if (selectEl.value !== previous) selectEl.value = '09:00';
    }

    function combineDateTime(dateValue, timeValue, allDay) {
        const date = String(dateValue || '').trim();
        if (!date) return '';
        if (allDay) return date;
        const time = String(timeValue || '').trim() || '00:00';
        return `${date} ${time}`;
    }


    function getDeviceTimeZone() {
        try {
            const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
            return typeof tz === 'string' ? tz : '';
        } catch {
            return '';
        }
    }

    function isValidTimeZone(tz) {
        if (!tz) return false;
        try {
            new Intl.DateTimeFormat('en-US', {timeZone: tz}).format(new Date());
            return true;
        } catch {
            return false;
        }
    }

    function getTimeZoneList() {
        let zones = [];
        try {
            if (typeof Intl.supportedValuesOf === 'function') {
                zones = Intl.supportedValuesOf('timeZone');
            }
        } catch {
            zones = [];
        }

        if (!Array.isArray(zones) || !zones.length) zones = FALLBACK_TIME_ZONES;

        const deviceTz = getDeviceTimeZone();
        if (isValidTimeZone(deviceTz)) zones = [deviceTz, ...zones];

        return Array.from(new Set(zones.filter(isValidTimeZone))).sort((a, b) => a.localeCompare(b));
    }

    function fillTimeZoneSelect(selectEl) {
        const deviceTz = getDeviceTimeZone();
        selectEl.innerHTML = '';
        selectEl.appendChild(el('option', {value: ''}, ['']));

        for (const tz of getTimeZoneList()) {
            selectEl.appendChild(el('option', {value: tz}, [tz]));
        }

        if (deviceTz && Array.from(selectEl.options).some((option) => option.value === deviceTz)) {
            selectEl.value = deviceTz;
        }
    }

    function normalizeWeekdays(inputs) {
        return inputs.filter((input) => input.checked).map((input) => input.value).join(',');
    }

    function createField(labelText, control, className = '') {
        const label = el('label', {class: ['mc-event-field', className].filter(Boolean).join(' ')}, [
            el('span', {class: 'mc-event-field-label'}, [labelText]),
            control,
        ]);
        if (control.id) label.htmlFor = control.id;
        return label;
    }

    function createSection(legendText, children, className = '') {
        return el('fieldset', {class: ['mc-event-section', className].filter(Boolean).join(' ')}, [
            el('legend', {class: 'mc-event-section-title'}, [legendText]),
            ...children,
        ]);
    }

    function init() {
        const root = document.getElementById(IDS.root);
        if (!root) return;

        const folderSelect = el('select', {
            id: IDS.targetFolder,
            name: 'targetFolderId',
            required: 'required',
            class: 'mc-setting-select-control mc-flex-1 mc-w-100',
            'aria-describedby': IDS.status,
        });

        function requestFolders() {
            postToPlugin({name: MSG.REQUEST_FOLDERS});
        }

        function populateFolders(list) {
            const desired = safeGetLS(LS.targetFolderId, '');
            folderSelect.innerHTML = '';
            folderSelect.appendChild(el('option', {value: '', disabled: true}, ['Select a notebook...']));

            for (const f of list || []) {
                const prefix = f.depth ? '- '.repeat(Math.min(10, f.depth)) : '';
                folderSelect.appendChild(el('option', {value: f.id}, [prefix + f.title]));
            }

            const hasDesired = desired && Array.from(folderSelect.options).some((o) => o.value === desired);
            if (hasDesired) folderSelect.value = desired;
            else if (folderSelect.options.length > 1) folderSelect.selectedIndex = 1;

            if (!folderSelect.value && folderSelect.options.length > 1) folderSelect.selectedIndex = 1;
        }

        function requestTags() {
            postToPlugin({name: MSG.REQUEST_TAGS});
        }

        let visibleTagOptionLimit = MAX_VISIBLE_TAG_OPTIONS;

        function getSelectedTagIds() {
            return Array.from(tagSelect.selectedOptions).map((option) => option.value).filter(Boolean);
        }

        function updateTagSummary() {
            const selectedCount = getSelectedTagIds().length;
            tagSummary.textContent = selectedCount ? `${selectedCount} selected` : 'None selected';
            tagPickerButtonText.textContent = selectedCount ? `${selectedCount} tag${selectedCount === 1 ? '' : 's'} selected` : 'Select tags';
            tagPickerValue.innerHTML = '';

            for (const option of tagSelect.selectedOptions) {
                tagPickerValue.appendChild(el('span', {class: 'mc-event-tag-badge'}, [
                    el('span', {}, [option.textContent || option.value]),
                    el('button', {
                        type: 'button',
                        class: 'mc-event-tag-remove',
                        'aria-label': `Remove ${option.textContent || option.value}`,
                        onclick: (event) => {
                            event.stopPropagation();
                            option.selected = false;
                            tagSelect.dispatchEvent(new Event('change'));
                        },
                    }, ['×']),
                ]));
            }

            if (!tagDropdown.hidden) renderTagOptions(tagSearchInput.value);
        }

        function renderTagOptions(query = '') {
            const normalizedQuery = String(query).trim().toLocaleLowerCase();
            tagOptions.innerHTML = '';
            const allMatches = Array.from(tagSelect.options).filter((option) => (
                option.value && (!normalizedQuery || (option.textContent || '').toLocaleLowerCase().includes(normalizedQuery))
            ));
            const matchingOptions = allMatches.slice(0, visibleTagOptionLimit);

            for (const option of matchingOptions) {
                const checkbox = el('input', {type: 'checkbox', checked: option.selected, value: option.value});
                checkbox.addEventListener('change', () => {
                    option.selected = checkbox.checked;
                    tagSelect.dispatchEvent(new Event('change'));
                });
                tagOptions.appendChild(el('label', {class: 'mc-event-tag-option'}, [checkbox, el('span', {}, [option.textContent || option.value])]));
            }

            if (allMatches.length > matchingOptions.length) {
                const remaining = allMatches.length - matchingOptions.length;
                const nextPageSize = Math.min(MAX_VISIBLE_TAG_OPTIONS, remaining);
                tagOptions.appendChild(el('div', {class: 'mc-event-tags-pagination'}, [
                    el('span', {class: 'mc-event-tags-limit', role: 'status'}, [
                        `Showing ${matchingOptions.length} of ${allMatches.length}`,
                    ]),
                    el('button', {
                        type: 'button',
                        class: 'mc-event-tags-load-more',
                        onclick: (event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            const scrollTop = tagOptions.scrollTop;
                            visibleTagOptionLimit += MAX_VISIBLE_TAG_OPTIONS;
                            renderTagOptions(query);
                            tagOptions.scrollTop = scrollTop;
                        },
                    }, [`Load ${nextPageSize} more`]),
                ]));
            } else if (!matchingOptions.length) {
                tagOptions.appendChild(el('div', {class: 'mc-event-tags-empty'}, [tagSelect.disabled ? 'No tags available' : 'No matching tags']));
            }
        }

        function setTagPickerOpen(open) {
            const shouldOpen = Boolean(open) && !tagSelect.disabled;
            tagPicker.classList.toggle('mc-open', shouldOpen);
            tagPickerButton.setAttribute('aria-expanded', shouldOpen ? 'true' : 'false');
            tagDropdown.hidden = !shouldOpen;
            if (shouldOpen) {
                tagSearchInput.value = '';
                visibleTagOptionLimit = MAX_VISIBLE_TAG_OPTIONS;
                renderTagOptions();
                tagSearchInput.focus();
            }
        }

        function populateTags(list) {
            const selected = new Set(getSelectedTagIds());
            tagSelect.innerHTML = '';

            for (const tag of list || []) {
                if (!tag || !tag.id || !tag.title) continue;
                const option = el('option', {value: tag.id}, [tag.title]);
                option.selected = selected.has(tag.id);
                tagSelect.appendChild(option);
            }

            if (!tagSelect.options.length) {
                tagSelect.appendChild(el('option', {value: '', disabled: true}, ['No tags']));
                tagSelect.disabled = true;
            } else {
                tagSelect.disabled = false;
            }
            tagPickerButton.disabled = tagSelect.disabled;
            updateTagSummary();
        }

        folderSelect.addEventListener('change', () => {
            safeSetLS(LS.targetFolderId, folderSelect.value || '');
        });

        root.innerHTML = '';

        const titleInput = el('input', {
            id: IDS.title, name: 'title', type: 'text', maxlength: '500', required: 'required',
            autocomplete: 'off', class: 'mc-event-input', 'aria-describedby': IDS.status,
        });
        const startParts = getLocalParts(0);
        const endParts = getLocalParts(60);
        const startDateInput = el('input', {
            id: IDS.startDate,
            name: 'startDate',
            type: 'date',
            value: startParts.date,
            required: 'required',
            class: 'mc-event-input',
            'aria-describedby': IDS.status
        });
        const startTimeSelect = el('select', {
            id: IDS.startTime,
            name: 'startTime',
            class: 'mc-setting-select-control mc-w-100'
        });
        const endDateInput = el('input', {
            id: IDS.endDate,
            name: 'endDate',
            type: 'date',
            value: endParts.date,
            class: 'mc-event-input',
            'aria-describedby': IDS.status
        });
        const endTimeSelect = el('select', {
            id: IDS.endTime,
            name: 'endTime',
            class: 'mc-setting-select-control mc-w-100'
        });
        fillTimeSelect(startTimeSelect, startParts.time);
        fillTimeSelect(endTimeSelect, endParts.time);
        const tzSelect = el('select', {
            id: IDS.timeZone,
            name: 'timezone',
            class: 'mc-setting-select-control mc-w-100'
        });
        fillTimeZoneSelect(tzSelect);
        const allDayInput = el('input', {id: IDS.allDay, name: 'allDay', type: 'checkbox'});
        const colorInput = el('input', {id: IDS.color, name: 'color', type: 'color', value: getDefaultEventColor()});
        const locationInput = el('input', {
            id: IDS.location,
            name: 'location',
            type: 'text',
            maxlength: '1000',
            autocomplete: 'off',
            class: 'mc-event-input'
        });
        const descriptionInput = el('textarea', {
            id: IDS.description,
            name: 'description',
            maxlength: '10000',
            rows: '4',
            class: 'mc-event-input'
        });
        const tagSelect = el('select', {
            id: IDS.tags,
            multiple: 'multiple',
            tabindex: '-1',
            'aria-hidden': 'true',
            class: 'mc-event-tags-select'
        });
        const tagSummary = el('span', {class: 'mc-event-tags-summary'}, ['None selected']);
        const tagPickerButtonText = el('span', {class: 'mc-event-tags-placeholder'}, ['Select tags']);
        const tagPickerButton = el('button', {
            id: IDS.tagsButton, type: 'button', disabled: true, class: 'mc-event-tags-toggle',
            'aria-haspopup': 'dialog', 'aria-expanded': 'false', 'aria-controls': IDS.tagsDropdown,
        }, [tagPickerButtonText, el('span', {class: 'mc-event-tags-chevron', 'aria-hidden': 'true'}, ['▾'])]);
        const tagPickerValue = el('div', {class: 'mc-event-tags-value'});
        const tagSearchInput = el('input', {
            type: 'search', class: 'mc-event-tags-search', placeholder: 'Search tags…', 'aria-label': 'Search tags',
        });
        const tagOptions = el('div', {
            id: IDS.tagsOptions,
            class: 'mc-event-tags-options',
            role: 'group',
            'aria-label': 'Available tags'
        });
        const tagDropdown = el('div', {
            id: IDS.tagsDropdown,
            class: 'mc-event-tags-dropdown',
            role: 'dialog',
            'aria-label': 'Select tags',
            hidden: 'hidden'
        }, [tagSearchInput, tagOptions]);
        const tagPicker = el('div', {class: 'mc-event-tags-picker'}, [tagPickerValue, tagPickerButton, tagDropdown, tagSelect]);
        const repeatSelect = el('select', {
            id: IDS.repeat,
            name: 'repeat',
            class: 'mc-setting-select-control mc-w-100',
            'aria-controls': IDS.repeatDetails
        }, [
            el('option', {value: 'none'}, ['Does not repeat']),
            el('option', {value: 'daily'}, ['Daily']),
            el('option', {value: 'weekly'}, ['Weekly']),
            el('option', {value: 'monthly'}, ['Monthly']),
            el('option', {value: 'yearly'}, ['Yearly']),
        ]);
        const repeatIntervalInput = el('input', {
            id: IDS.repeatInterval,
            name: 'repeatInterval',
            type: 'number',
            min: '1',
            max: '999',
            value: '1',
            class: 'mc-event-input'
        });
        const repeatUntilInput = el('input', {
            id: IDS.repeatUntil,
            name: 'repeatUntil',
            type: 'date',
            class: 'mc-event-input'
        });
        const byMonthDayInput = el('input', {
            id: IDS.monthDay,
            name: 'monthDay',
            type: 'number',
            min: '1',
            max: '31',
            class: 'mc-event-input'
        });
        const exdatesInput = el('textarea', {
            id: IDS.excludeDates,
            name: 'excludeDates',
            rows: '3',
            class: 'mc-event-input',
            placeholder: '2026-02-10 09:00',
            'aria-describedby': 'mc-event-exclude-dates-help'
        });
        const weekdayInputs = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'].map((day) => el('input', {
            id: `mc-event-weekday-${day.toLowerCase()}`,
            name: 'weekdays',
            type: 'checkbox',
            value: day
        }));
        const recurrenceDetails = el('div', {id: IDS.repeatDetails, class: 'mc-event-recurrence-details'});
        const submitBtn = el('button', {
            type: 'submit',
            class: 'mc-setting-btn mc-event-submit',
            title: 'Create event'
        }, ['Create']);
        const resetBtn = el('button', {type: 'reset', class: 'mc-setting-btn'}, ['Reset']);
        const reloadBtn = el('button', {type: 'button', class: 'mc-setting-btn', onclick: requestFolders}, ['Reload']);

        const form = el('form', {id: IDS.form, novalidate: 'novalidate'}, []);
        const status = el('div', {
            id: IDS.status,
            class: 'mc-event-form-status',
            role: 'status',
            'aria-live': 'polite',
            'aria-atomic': 'true'
        });
        const loader = el('div', {
            class: 'mc-grid-loader',
            'aria-hidden': 'true'
        }, [el('div', {class: 'mc-grid-spinner'})]);
        form.appendChild(loader);

        function setFormStatus(text = '', kind = '') {
            status.textContent = text;
            status.dataset.kind = kind;
            if (kind === 'error') uiLogger.error(text);
            else if (text) uiLogger.debug(text);
        }

        function clearValidationState() {
            for (const control of form.querySelectorAll('[aria-invalid="true"]')) {
                control.removeAttribute('aria-invalid');
            }
        }

        function reportValidationError(message, control) {
            clearValidationState();
            control?.setAttribute('aria-invalid', 'true');
            setFormStatus(message, 'error');
            control?.focus();
        }

        function setEventLoading(isLoading) {
            form.classList.toggle('mc-loading', !!isLoading);
            form.setAttribute('aria-busy', isLoading ? 'true' : 'false');
            for (const control of form.querySelectorAll('input, textarea, select, button')) {
                control.disabled = !!isLoading;
            }
            if (!isLoading) {
                const hasTags = Array.from(tagSelect.options).some((option) => option.value);
                tagSelect.disabled = !hasTags;
                tagPickerButton.disabled = !hasTags;
                updateDateInputModes();
                updateRecurrenceVisibility();
            } else {
                setTagPickerOpen(false);
            }
        }

        function updateDateInputModes() {
            const allDay = !!allDayInput.checked;
            startTimeSelect.disabled = allDay;
            endTimeSelect.disabled = allDay;
        }

        function refreshTimeFormat() {
            fillTimeSelect(startTimeSelect, startTimeSelect.value);
            fillTimeSelect(endTimeSelect, endTimeSelect.value);
            updateDateInputModes();
        }

        function updateRecurrenceVisibility() {
            const isVisible = repeatSelect.value !== 'none';
            recurrenceDetails.hidden = !isVisible;
            repeatSelect.setAttribute('aria-expanded', isVisible ? 'true' : 'false');
            for (const control of recurrenceDetails.querySelectorAll('input, textarea, select')) {
                control.disabled = !isVisible;
            }
        }

        function validatePayload(payload) {
            if (!payload.targetFolderId) return {message: 'Select a target notebook.', control: folderSelect};
            if (!payload.title) return {message: 'Title is required.', control: titleInput};
            if (!payload.start) return {message: 'Start date is required.', control: startDateInput};
            if (payload.color && !normalizeHexColor(payload.color)) return {
                message: 'Color must be a hex value.',
                control: colorInput
            };
            if (payload.end && payload.end < payload.start) return {
                message: 'End date/time must be after start.',
                control: endDateInput
            };
            return null;
        }

        function collectPayload() {
            const allDay = !!allDayInput.checked;
            return {
                targetFolderId: String(folderSelect.value || '').trim(),
                title: String(titleInput.value || '').trim(),
                start: combineDateTime(startDateInput.value, startTimeSelect.value, allDay),
                end: combineDateTime(endDateInput.value, endTimeSelect.value, allDay),
                tz: String(tzSelect.value || '').trim(),
                all_day: allDay,
                color: colorInput.value,
                location: String(locationInput.value || '').trim(),
                description: String(descriptionInput.value || '').trim(),
                repeat: repeatSelect.value,
                repeat_interval: repeatIntervalInput.value,
                repeat_until: repeatUntilInput.value,
                byweekday: normalizeWeekdays(weekdayInputs),
                bymonthday: byMonthDayInput.value,
                exdates: exdatesInput.value,
                tagIds: getSelectedTagIds(),
            };
        }

        function resetEventForm() {
            titleInput.value = '';
            const nextStartParts = getLocalParts(0);
            const nextEndParts = getLocalParts(60);
            startDateInput.value = nextStartParts.date;
            endDateInput.value = nextEndParts.date;
            fillTimeSelect(startTimeSelect, nextStartParts.time);
            fillTimeSelect(endTimeSelect, nextEndParts.time);
            allDayInput.checked = false;
            colorInput.value = getDefaultEventColor();
            locationInput.value = '';
            descriptionInput.value = '';
            repeatSelect.value = 'none';
            repeatIntervalInput.value = '1';
            repeatUntilInput.value = '';
            byMonthDayInput.value = '';
            exdatesInput.value = '';
            weekdayInputs.forEach((input) => {
                input.checked = false;
            });
            Array.from(tagSelect.options).forEach((option) => {
                option.selected = false;
            });
            updateTagSummary();
            updateRecurrenceVisibility();
            clearValidationState();
            setFormStatus();
            titleInput.focus();
        }

        allDayInput.addEventListener('change', updateDateInputModes);
        repeatSelect.addEventListener('change', updateRecurrenceVisibility);
        tagSelect.addEventListener('change', updateTagSummary);
        tagPickerButton.addEventListener('click', () => setTagPickerOpen(tagDropdown.hidden));
        tagSearchInput.addEventListener('input', () => {
            visibleTagOptionLimit = MAX_VISIBLE_TAG_OPTIONS;
            renderTagOptions(tagSearchInput.value);
        });
        tagPicker.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') {
                setTagPickerOpen(false);
                tagPickerButton.focus();
            }
        });
        document.addEventListener('click', (event) => {
            if (!tagPicker.contains(event.target)) setTagPickerOpen(false);
        });
        form.addEventListener('reset', (event) => {
            event.preventDefault();
            resetEventForm();
        });
        form.addEventListener('submit', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const payload = collectPayload();
            const validationError = validatePayload(payload);
            if (validationError) {
                reportValidationError(validationError.message, validationError.control);
                return;
            }
            clearValidationState();
            setEventLoading(true);
            setFormStatus('Creating event note…', 'info');
            postToPlugin({name: MSG.CALENDAR_EVENT_CREATE, payload});
        });

        const folderRow = el('div', {class: 'mc-event-notebook-row'}, [
            createField('Notebook', folderSelect, 'mc-event-notebook-field'),
            reloadBtn,
        ]);

        const weekdaysRow = el('div', {class: 'mc-event-weekdays'}, weekdayInputs.map((input) => (
            el('label', {class: 'mc-event-weekday'}, [input, el('span', {}, [input.value])])
        )));

        recurrenceDetails.appendChild(el('div', {class: 'mc-event-grid-2'}, [
            createField('Every', repeatIntervalInput),
            createField('Until', repeatUntilInput),
            createField('Day of month', byMonthDayInput),
            createField('Exclude dates', exdatesInput),
        ]));
        recurrenceDetails.appendChild(el('p', {
            id: 'mc-event-exclude-dates-help',
            class: 'mc-event-help'
        }, ['Use one local date/time per line, for example 2026-02-10 09:00.']));
        recurrenceDetails.appendChild(el('div', {
            class: 'mc-event-weekdays-group',
            role: 'group',
            'aria-label': 'Repeat on weekdays'
        }, [weekdaysRow]));

        const detailsSection = createSection('Event details', [
            folderRow,
            createField('Title', titleInput, 'mc-event-field-full'),
            el('div', {class: 'mc-event-grid-2'}, [
                createField('Location', locationInput),
                createField('Color', colorInput),
            ]),
            createField('Description', descriptionInput, 'mc-event-field-full'),
        ]);
        const scheduleSection = createSection('Date and time', [
            el('label', {
                class: 'mc-event-checkbox-field',
                for: IDS.allDay
            }, [allDayInput, el('span', {}, ['All day'])]),
            el('div', {class: 'mc-event-grid-2'}, [
                createField('Start date', startDateInput),
                createField('Start time', startTimeSelect),
                createField('End date', endDateInput),
                createField('End time', endTimeSelect),
                createField('Timezone', tzSelect, 'mc-event-field-full'),
            ]),
        ]);
        const recurrenceSection = createSection('Recurrence', [
            createField('Repeat', repeatSelect),
            recurrenceDetails,
        ]);
        const tagsSection = createSection('Tags', [
            tagPicker,
        ]);

        form.appendChild(detailsSection);
        form.appendChild(scheduleSection);
        form.appendChild(recurrenceSection);
        form.appendChild(tagsSection);
        form.appendChild(status);
        form.appendChild(el('div', {class: 'mc-event-actions'}, [resetBtn, submitBtn]));
        root.appendChild(form);

        updateRecurrenceVisibility();
        updateDateInputModes();

        mcRegisterOnMessage((msg) => {
            if (!msg || !msg.name) return;
            if (msg.name === MSG.FOLDERS) populateFolders(msg.folders);
            if (msg.name === MSG.TAGS) populateTags(msg.tags);
            if (msg.name === MSG.CALENDAR_EVENT_CREATE_DONE) {
                setEventLoading(false);
                setFormStatus(`Event note created: ${msg.title || ''}`.trim(), 'success');
                titleInput.value = '';
            }
            if (msg.name === MSG.CALENDAR_EVENT_CREATE_ERROR) {
                setEventLoading(false);
                setFormStatus(msg.error || 'Event creation failed.', 'error');
            }
            if (msg.name === MSG.UI_SETTINGS) {
                if (typeof msg.debug === 'boolean') uiSettings.debug = msg.debug;
                if (typeof msg.defaultEventColor === 'string') {
                    uiSettings.defaultEventColor = msg.defaultEventColor;
                    const nextColor = getDefaultEventColor();
                    if (nextColor) colorInput.value = nextColor;
                }
                if (typeof msg.defaultEventColorLight === 'string') {
                    uiSettings.defaultEventColorLight = msg.defaultEventColorLight;
                    const nextColor = getDefaultEventColor();
                    if (nextColor) colorInput.value = nextColor;
                }
                if (typeof msg.defaultEventColorDark === 'string') {
                    uiSettings.defaultEventColorDark = msg.defaultEventColorDark;
                    const nextColor = getDefaultEventColor();
                    if (nextColor) colorInput.value = nextColor;
                }
                if (msg.timeFormat === '12h' || msg.timeFormat === '24h') {
                    uiSettings.timeFormat = msg.timeFormat;
                    refreshTimeFormat();
                }
            }
        });

        postToPlugin({name: MSG.UI_READY});
        requestFolders();
        requestTags();
        uiLogger.debug('initialized');
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
