// "Create" preferences page: turns a dropped image into a dynamic wallpaper
// made of several color-toned variants shown at different hours of the day.

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Gdk from 'gi://Gdk?version=4.0';
import Gtk from 'gi://Gtk?version=4.0';
import Pango from 'gi://Pango';
import Adw from 'gi://Adw';

import {confirm} from './galleryPage.js';
import {_, format} from './i18n.js';
import {imageToPixbuf, imageToTexture, loadSource, pixbufToImage} from './image.js';
import {NEUTRAL, applyTone, blend, defaultVariants, rgbToHex} from './tone.js';
import {
    applyWallpaper, backgroundsDir, buildSchedule, deleteRecursive, isCurrent,
    isInstalled, readProject, sanitizeCode, scheduleAt, slideshowPath, timedDir,
    uninstallWallpaper, writeDynamicWallpaper, writeText,
} from './wallpapers.js';

const PREVIEW_WIDTH = 1280;
const THUMB_WIDTH = 160;
const MIN_VARIANTS = 2;
const MAX_VARIANTS = 12;

const HOUR_HINT = () => _('When this variant is fully shown');
const CREATE_LABEL = () => _('Create Dynamic Wallpaper');
const SAVE_LABEL = () => _('Save Changes');
const TONE_KEYS = ['brightness', 'contrast', 'saturation', 'tint', 'tintStrength'];

const formatHour = hours => {
    const h = Math.floor(hours) % 24;
    const m = Math.round((hours - Math.floor(hours)) * 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};

const idle = () => new Promise(resolve => GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
    resolve();
    return GLib.SOURCE_REMOVE;
}));

function makeScaleRow(title, subtitle, min, max, step, defaultValue) {
    const scale = new Gtk.Scale({
        adjustment: new Gtk.Adjustment({lower: min, upper: max, step_increment: step, page_increment: step * 10}),
        draw_value: true,
        digits: 2,
        value_pos: Gtk.PositionType.RIGHT,
        hexpand: true,
        width_request: 280,
        valign: Gtk.Align.CENTER,
    });
    scale.add_mark(defaultValue, Gtk.PositionType.BOTTOM, null);
    const row = new Adw.ActionRow({title, subtitle});
    row.add_suffix(scale);
    return {row, scale};
}

export class CreatorPage {
    constructor(window, {onCreated}) {
        this._window = window;
        this._onCreated = onCreated;
        this._source = null;
        this._sourcePath = null;
        // {code, name} of the wallpaper being edited, null when creating one.
        this._editing = null;
        this._variants = defaultVariants();
        this._selected = this._variants[3];
        this._cache = new Map();
        this._updating = false;
        this._refreshId = 0;
        this._playId = 0;
        this._busy = false;

        this.page = new Adw.PreferencesPage({
            title: _('Create'),
            icon_name: 'image-x-generic-symbolic',
        });

        this._buildSourceGroup();
        this._buildPreviewGroup();
        this._buildVariantsGroup();
        this._buildEditorGroup();
        this._buildCreateGroup();
        this._setLoaded(false);

        this._banner = new Adw.Banner({button_label: _('New Wallpaper')});
        this._banner.connect('button-clicked', () => this._reset());
        this.page.banner = this._banner;

        window.connect('close-request', () => {
            this._stopPlaying();
            if (this._refreshId)
                GLib.source_remove(this._refreshId);
            this._refreshId = 0;
            return false;
        });
    }

    _toast(title) {
        this._window.add_toast(new Adw.Toast({title, timeout: 4}));
    }

    // ---- Source image --------------------------------------------------

    _buildSourceGroup() {
        const group = new Adw.PreferencesGroup({
            title: _('Source Image'),
            description: _('Each variant is a copy of this image with its own color tone, shown at its own hour.'),
        });

        this._dropZone = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 12,
            css_classes: ['dgw-drop-zone'],
        });
        this._dropIcon = new Gtk.Image({pixel_size: 48, css_classes: ['dim-label']});
        this._dropTitle = new Gtk.Label({css_classes: ['title-3'], wrap: true});
        this._dropSubtitle = new Gtk.Label({
            css_classes: ['dim-label'],
            wrap: true,
            justify: Gtk.Justification.CENTER,
        });
        const choose = new Gtk.Button({
            label: _('Choose an Image…'),
            halign: Gtk.Align.CENTER,
            css_classes: ['pill'],
        });
        choose.connect('clicked', () => this._chooseFile());
        for (const w of [this._dropIcon, this._dropTitle, this._dropSubtitle, choose])
            this._dropZone.append(w);
        this._resetDropZone();
        group.add(this._dropZone);

        // Accept drops anywhere on the page, highlight the drop zone.
        const target = Gtk.DropTarget.new(Gio.File.$gtype, Gdk.DragAction.COPY);
        target.connect('enter', () => {
            this._dropZone.add_css_class('dgw-drop-hover');
            return Gdk.DragAction.COPY;
        });
        target.connect('leave', () => this._dropZone.remove_css_class('dgw-drop-hover'));
        target.connect('drop', (_t, file) => {
            this._dropZone.remove_css_class('dgw-drop-hover');
            return this._loadFile(file);
        });
        this.page.add_controller(target);

        this.page.add(group);
    }

    _chooseFile() {
        const filter = new Gtk.FileFilter({name: _('Images')});
        filter.add_pixbuf_formats();
        const filters = new Gio.ListStore({item_type: Gtk.FileFilter.$gtype});
        filters.append(filter);
        const dialog = new Gtk.FileDialog({title: _('Choose an Image'), filters, default_filter: filter});
        dialog.open(this._window, null, (_d, result) => {
            try {
                this._loadFile(dialog.open_finish(result));
            } catch (e) {
                if (!e.matches?.(Gtk.DialogError, Gtk.DialogError.DISMISSED))
                    this._toast(e.message);
            }
        });
    }

    _loadFile(file) {
        const path = file?.get_path();
        if (!path) {
            this._toast(_('Only local files are supported'));
            return false;
        }
        try {
            this._loadSource(path);
        } catch (e) {
            this._toast(format(_('Unreadable image: {error}'), {error: e.message}));
            return false;
        }
        // When editing, a new image only replaces the source.
        if (!this._editing) {
            const base = GLib.path_get_basename(path).replace(/\.[^.]+$/, '');
            this._nameRow.text = base.replace(/[_-]+/g, ' ');
        }
        this._rebuildStrip();
        this._scheduleRefresh();
        return true;
    }

    _loadSource(path) {
        this._source = loadSource(path, PREVIEW_WIDTH, THUMB_WIDTH);
        this._sourcePath = path;
        this._cache.clear();

        this._dropIcon.icon_name = 'image-x-generic-symbolic';
        this._dropTitle.label = GLib.path_get_basename(path);
        this._dropSubtitle.label =
            format(_('{width} × {height} px · drop another image to replace it'), {
                width: this._source.full.get_width(),
                height: this._source.full.get_height(),
            });
        this._setLoaded(true);
    }

    _resetDropZone() {
        this._dropIcon.icon_name = 'folder-pictures-symbolic';
        this._dropTitle.label = _('Drop an Image Here');
        this._dropSubtitle.label = _('JPEG, PNG, WebP… The original resolution is kept.');
    }

    /**
     * Opens a wallpaper made with this page to edit it.
     *
     * @returns {boolean} whether it could be opened
     */
    edit(wallpaper) {
        if (this._busy)
            return false;
        const project = readProject(wallpaper.code);
        const valid = project?.variants.length >= MIN_VARIANTS && project.variants.length <= MAX_VARIANTS;
        try {
            if (!valid)
                throw new Error(_('missing or invalid project'));
            this._loadSource(project.source);
        } catch (e) {
            this._toast(format(_('Could not open “{name}”: {error}'), {name: wallpaper.name, error: e.message}));
            return false;
        }

        this._stopPlaying();
        this._variants = project.variants.map((v, i) => {
            const variant = {label: String(v.label ?? format(_('Variant {number}'), {number: i + 1})), hour: 0, ...NEUTRAL};
            for (const key of TONE_KEYS) {
                if (typeof v[key] === typeof NEUTRAL[key])
                    variant[key] = v[key];
            }
            if (Number.isInteger(v.hour))
                variant.hour = Math.min(23, Math.max(0, v.hour));
            return variant;
        });
        this._selected = this._variants[Math.floor(this._variants.length / 2)];
        this._nameRow.text = project.name ?? wallpaper.name;
        if (typeof project.transitionMinutes === 'number')
            this._transitionRow.value = project.transitionMinutes;
        this._setEditing({code: wallpaper.code, name: this._nameRow.text});

        this._rebuildStrip();
        this._scheduleRefresh();
        return true;
    }

    _setEditing(editing) {
        this._editing = editing;
        this._banner.revealed = Boolean(editing);
        if (editing)
            this._banner.title = format(_('Editing “{name}”'), {name: editing.name});
        this._applyRow.title = editing ? _('Apply After Saving') : _('Apply After Creation');
        if (!this._busy)
            this._createButton.label = editing ? SAVE_LABEL() : CREATE_LABEL();
    }

    /** Called when a wallpaper is removed: stop editing it, its source is gone. */
    forget(wallpaper) {
        if (this._editing?.code === wallpaper.code)
            this._reset();
    }

    /** Leaves edit mode and starts over with an empty page. */
    _reset() {
        if (this._busy)
            return;
        this._stopPlaying();
        this._source = null;
        this._sourcePath = null;
        this._cache.clear();
        this._variants = defaultVariants();
        this._selected = this._variants[3];
        this._nameRow.text = '';
        this._setEditing(null);
        this._resetDropZone();
        this._setLoaded(false);
        this._picture.set_paintable(null);
    }

    _setLoaded(loaded) {
        for (const group of [this._previewGroup, this._variantsGroup, this._editorGroup, this._createGroup])
            group.visible = loaded;
        this._dropZone.set_css_classes(loaded ? ['dgw-drop-zone', 'dgw-drop-compact'] : ['dgw-drop-zone']);
    }

    // ---- Preview -------------------------------------------------------

    _buildPreviewGroup() {
        this._previewGroup = new Adw.PreferencesGroup({title: _('Preview')});

        this._picture = new Gtk.Picture({
            content_fit: Gtk.ContentFit.CONTAIN,
            height_request: 340,
            can_shrink: true,
            overflow: Gtk.Overflow.HIDDEN,
            css_classes: ['dgw-preview'],
        });
        this._previewGroup.add(this._picture);

        this._previewCaption = new Gtk.Label({css_classes: ['dim-label'], margin_top: 6, margin_bottom: 6});
        this._previewGroup.add(this._previewCaption);

        this._simulateRow = new Adw.SwitchRow({
            title: _('Simulate a Day'),
            subtitle: _('Preview the wallpaper at the chosen time, transitions included'),
        });
        this._simulateRow.connect('notify::active', () => {
            this._timeRow.sensitive = this._simulateRow.active;
            if (!this._simulateRow.active)
                this._stopPlaying();
            this._scheduleRefresh();
        });
        // Rows added to a PreferencesGroup always go above other widgets, so
        // keep them in our own list to have them below the picture.
        const list = new Gtk.ListBox({selection_mode: Gtk.SelectionMode.NONE, css_classes: ['boxed-list']});
        list.append(this._simulateRow);
        this._previewGroup.add(list);

        this._timeScale = new Gtk.Scale({
            adjustment: new Gtk.Adjustment({lower: 0, upper: 24, step_increment: 0.25, page_increment: 1}),
            draw_value: true,
            digits: 2,
            value_pos: Gtk.PositionType.RIGHT,
            hexpand: true,
            valign: Gtk.Align.CENTER,
        });
        this._timeScale.set_format_value_func((_s, v) => formatHour(v));
        for (const h of [0, 6, 12, 18, 24])
            this._timeScale.add_mark(h, Gtk.PositionType.BOTTOM, h === 24 ? null : formatHour(h));
        this._timeScale.set_value(new Date().getHours() + new Date().getMinutes() / 60);
        this._timeScale.connect('value-changed', () => this._scheduleRefresh());

        this._playButton = new Gtk.Button({
            icon_name: 'media-playback-start-symbolic',
            tooltip_text: _('Play the Day'),
            valign: Gtk.Align.CENTER,
            css_classes: ['flat', 'circular'],
        });
        this._playButton.connect('clicked', () => (this._playId ? this._stopPlaying() : this._startPlaying()));

        this._timeRow = new Adw.ActionRow({title: _('Time'), sensitive: false});
        this._timeRow.add_suffix(this._timeScale);
        this._timeRow.add_suffix(this._playButton);
        list.append(this._timeRow);

        this.page.add(this._previewGroup);
    }

    _startPlaying() {
        this._playButton.icon_name = 'media-playback-pause-symbolic';
        this._playId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 40, () => {
            this._timeScale.set_value((this._timeScale.get_value() + 0.08) % 24);
            return GLib.SOURCE_CONTINUE;
        });
    }

    _stopPlaying() {
        if (this._playId)
            GLib.source_remove(this._playId);
        this._playId = 0;
        this._playButton.icon_name = 'media-playback-start-symbolic';
    }

    _processed(variant, kind) {
        let entry = this._cache.get(variant);
        if (!entry) {
            entry = {};
            this._cache.set(variant, entry);
        }
        if (!entry[kind]) {
            const img = this._source[kind];
            entry[kind] = applyTone(img.pixels, img, variant);
        }
        return entry[kind];
    }

    _scheduleRefresh() {
        if (this._refreshId || !this._source)
            return;
        this._refreshId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._refreshId = 0;
            this._refreshPreview();
            return GLib.SOURCE_REMOVE;
        });
    }

    _refreshPreview() {
        if (!this._source)
            return;
        const img = this._source.preview;

        if (!this._simulateRow.active) {
            this._picture.set_paintable(imageToTexture(img, this._processed(this._selected, 'preview')));
            this._previewCaption.label = `${this._selected.label} · ${formatHour(this._selected.hour)}`;
            return;
        }

        const hours = this._variants.map(v => v.hour);
        const schedule = buildSchedule(hours, this._transitionRow.value * 60);
        const time = this._timeScale.get_value();
        const {from, to, progress} = scheduleAt(schedule, time * 3600);
        const a = this._processed(this._variants[from], 'preview');
        const b = this._processed(this._variants[to], 'preview');
        if (!this._blendBuffer || this._blendBuffer.length !== a.length)
            this._blendBuffer = new Uint8Array(a.length);
        this._picture.set_paintable(imageToTexture(img, blend(a, b, progress, this._blendBuffer)));
        this._previewCaption.label = from === to
            ? `${formatHour(time)} · ${this._variants[from].label}`
            : `${formatHour(time)} · ${this._variants[from].label} → ${this._variants[to].label} (${Math.round(progress * 100)}%)`;
    }

    // ---- Variant strip -------------------------------------------------

    _buildVariantsGroup() {
        this._variantsGroup = new Adw.PreferencesGroup({
            title: _('Variants'),
            description: _('Select a variant to preview it and adjust its tone.'),
        });

        const buttons = new Gtk.Box({spacing: 6});
        const add = new Gtk.Button({icon_name: 'list-add-symbolic', tooltip_text: _('Add a Variant'), css_classes: ['flat']});
        add.connect('clicked', () => this._addVariant());
        const reset = new Gtk.Button({icon_name: 'edit-undo-symbolic', tooltip_text: _('Restore Default Variants'), css_classes: ['flat']});
        reset.connect('clicked', () => {
            this._variants = defaultVariants();
            this._selected = this._variants[3];
            this._cache.clear();
            this._rebuildStrip();
            this._scheduleRefresh();
        });
        buttons.append(add);
        buttons.append(reset);
        this._variantsGroup.set_header_suffix(buttons);
        this._addButton = add;

        this._strip = new Gtk.FlowBox({
            selection_mode: Gtk.SelectionMode.SINGLE,
            homogeneous: true,
            min_children_per_line: 3,
            max_children_per_line: 6,
            column_spacing: 6,
            row_spacing: 6,
        });
        this._strip.connect('selected-children-changed', () => {
            if (this._updating)
                return;
            const child = this._strip.get_selected_children()[0];
            if (!child)
                return;
            this._selected = this._variants[child.get_index()];
            this._syncEditor();
            this._scheduleRefresh();
        });
        this._variantsGroup.add(this._strip);
        this.page.add(this._variantsGroup);
    }

    _rebuildStrip() {
        this._variants.sort((a, b) => a.hour - b.hour);
        this._updating = true;
        this._strip.remove_all();
        this._stripPictures = new Map();
        this._stripLabels = new Map();
        for (const variant of this._variants) {
            const box = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 4, css_classes: ['dgw-variant']});
            const picture = new Gtk.Picture({
                content_fit: Gtk.ContentFit.COVER,
                height_request: 72,
                can_shrink: true,
                overflow: Gtk.Overflow.HIDDEN,
                css_classes: ['dgw-thumbnail'],
            });
            box.append(picture);
            const label = new Gtk.Label({label: variant.label, ellipsize: Pango.EllipsizeMode.END, css_classes: ['heading']});
            box.append(label);
            this._stripLabels.set(variant, label);
            box.append(new Gtk.Label({label: formatHour(variant.hour), css_classes: ['dim-label', 'caption']}));
            this._strip.append(box);
            this._stripPictures.set(variant, picture);
            this._updateThumb(variant);
        }
        const index = this._variants.indexOf(this._selected);
        this._strip.select_child(this._strip.get_child_at_index(Math.max(0, index)));
        this._updating = false;
        this._addButton.sensitive = this._variants.length < MAX_VARIANTS;
        this._syncEditor();
    }

    _updateThumb(variant) {
        const picture = this._stripPictures?.get(variant);
        if (picture && this._source)
            picture.set_paintable(imageToTexture(this._source.thumb, this._processed(variant, 'thumb')));
    }

    _addVariant() {
        const used = new Set(this._variants.map(v => v.hour));
        let hour = this._selected.hour;
        do
            hour = (hour + 1) % 24;
        while (used.has(hour) && used.size < 24);
        if (used.has(hour))
            return;
        const variant = {...this._selected, hour, label: format(_('Variant {number}'), {number: this._variants.length + 1})};
        this._variants.push(variant);
        this._selected = variant;
        this._rebuildStrip();
        this._scheduleRefresh();
    }

    _removeSelected() {
        if (this._variants.length <= MIN_VARIANTS)
            return;
        const index = this._variants.indexOf(this._selected);
        this._variants.splice(index, 1);
        this._cache.delete(this._selected);
        this._selected = this._variants[Math.min(index, this._variants.length - 1)];
        this._rebuildStrip();
        this._scheduleRefresh();
    }

    // ---- Variant editor ------------------------------------------------

    _buildEditorGroup() {
        this._editorGroup = new Adw.PreferencesGroup({title: _('Variant Tone')});

        const resetTone = new Gtk.Button({label: _('Neutral'), tooltip_text: _('Reset the tone (original image)'), css_classes: ['flat']});
        resetTone.connect('clicked', () => {
            Object.assign(this._selected, NEUTRAL);
            this._toneChanged();
            this._syncEditor();
        });
        this._editorGroup.set_header_suffix(resetTone);

        this._labelRow = new Adw.EntryRow({title: _('Name')});
        this._labelRow.connect('changed', () => {
            if (this._updating)
                return;
            this._selected.label = this._labelRow.text || _('Untitled');
            const label = this._stripLabels?.get(this._selected);
            if (label)
                label.label = this._selected.label;
            this._scheduleRefresh();
        });
        this._editorGroup.add(this._labelRow);

        this._hourRow = Adw.SpinRow.new_with_range(0, 23, 1);
        this._hourRow.title = _('Hour');
        this._hourRow.subtitle = HOUR_HINT();
        this._hourRow.connect('notify::value', () => {
            if (this._updating)
                return;
            this._selected.hour = this._hourRow.value;
            this._rebuildStrip();
            this._scheduleRefresh();
        });
        this._editorGroup.add(this._hourRow);

        const sliders = [
            ['brightness', _('Brightness'), _('Darkens or lightens the image'), -1, 1, 0.01],
            ['contrast', _('Contrast'), null, 0.5, 1.5, 0.01],
            ['saturation', _('Saturation'), _('0 = black and white'), 0, 2, 0.01],
            ['tintStrength', _('Tint Strength'), null, 0, 1, 0.01],
        ];
        this._scales = {};
        for (const [key, title, subtitle, min, max, step] of sliders) {
            const {row, scale} = makeScaleRow(title, subtitle, min, max, step, NEUTRAL[key]);
            scale.connect('value-changed', () => {
                if (this._updating)
                    return;
                this._selected[key] = scale.get_value();
                this._toneChanged();
            });
            this._scales[key] = scale;
            this._editorGroup.add(row);
        }

        this._colorButton = new Gtk.ColorDialogButton({
            dialog: new Gtk.ColorDialog({title: _('Tint Color'), with_alpha: false}),
            valign: Gtk.Align.CENTER,
        });
        this._colorButton.connect('notify::rgba', () => {
            if (this._updating)
                return;
            const {red, green, blue} = this._colorButton.rgba;
            this._selected.tint = rgbToHex(red, green, blue);
            if (this._selected.tintStrength === 0) {
                // Picking a color without strength would look like a no-op.
                this._selected.tintStrength = 0.5;
                this._syncEditor();
            }
            this._toneChanged();
        });
        const colorRow = new Adw.ActionRow({
            title: _('Tint Color'),
            subtitle: _('Soft light blend: a mid gray is neutral'),
        });
        colorRow.add_suffix(this._colorButton);
        this._editorGroup.add(colorRow);

        this._removeRow = new Adw.ButtonRow({title: _('Remove This Variant'), css_classes: ['destructive-action']});
        this._removeRow.connect('activated', () => this._removeSelected());
        this._editorGroup.add(this._removeRow);

        this.page.add(this._editorGroup);
    }

    _toneChanged() {
        this._cache.delete(this._selected);
        this._updateThumb(this._selected);
        this._scheduleRefresh();
    }

    _syncEditor() {
        const v = this._selected;
        this._updating = true;
        this._editorGroup.title = format(_('Tone of “{name}”'), {name: v.label});
        this._labelRow.text = v.label;
        this._hourRow.value = v.hour;
        const duplicate = this._variants.some(o => o !== v && o.hour === v.hour);
        this._hourRow.subtitle = duplicate
            ? _('⚠ Another variant already uses this hour')
            : HOUR_HINT();
        for (const [key, scale] of Object.entries(this._scales))
            scale.set_value(v[key]);
        const rgba = new Gdk.RGBA();
        rgba.parse(v.tint);
        this._colorButton.rgba = rgba;
        this._removeRow.sensitive = this._variants.length > MIN_VARIANTS;
        this._updating = false;
    }

    // ---- Creation ------------------------------------------------------

    _buildCreateGroup() {
        this._createGroup = new Adw.PreferencesGroup({title: _('Creation')});

        this._nameRow = new Adw.EntryRow({title: _('Wallpaper Name')});
        this._createGroup.add(this._nameRow);

        this._transitionRow = Adw.SpinRow.new_with_range(0, 360, 15);
        this._transitionRow.title = _('Transition Length (minutes)');
        this._transitionRow.subtitle = _('Fade between two variants, capped by the gap between their hours');
        this._transitionRow.value = 120;
        this._transitionRow.connect('notify::value', () => this._scheduleRefresh());
        this._createGroup.add(this._transitionRow);

        this._applyRow = new Adw.SwitchRow({title: _('Apply After Creation'), active: true});
        this._createGroup.add(this._applyRow);

        this._createButton = new Gtk.Button({
            label: CREATE_LABEL(),
            halign: Gtk.Align.CENTER,
            margin_top: 18,
            css_classes: ['pill', 'suggested-action'],
        });
        this._createButton.connect('clicked', () => this._create().catch(e => {
            logError(e);
            this._toast(format(_('Could not create the wallpaper: {error}'), {error: e.message}));
        }));
        this._createGroup.add(this._createButton);

        this.page.add(this._createGroup);
    }

    async _create() {
        if (this._busy || !this._source)
            return;

        const name = this._nameRow.text.trim();
        const code = sanitizeCode(name);
        if (!code) {
            this._toast(_('Give the wallpaper a name'));
            this._nameRow.grab_focus();
            return;
        }
        const hours = this._variants.map(v => v.hour);
        if (new Set(hours).size !== hours.length) {
            this._toast(_('Two variants can’t share the same hour'));
            return;
        }
        const editedCode = this._editing?.code ?? null;
        if (code !== editedCode && isInstalled(code) && !await confirm(this._window,
            format(_('“{name}” Already Exists'), {name}),
            _('The existing wallpaper will be replaced.'), _('Replace')))
            return;

        this._busy = true;
        this._createButton.sensitive = false;
        // Everything is generated aside, then swapped in, so that a failure
        // leaves the existing wallpaper untouched (and the edited source,
        // stored in timedDir(), is still readable while generating).
        const tmpDir = GLib.build_filenamev([backgroundsDir(), `.${code}-timed.tmp`]);
        try {
            deleteRecursive(tmpDir);
            GLib.mkdir_with_parents(tmpDir, 0o755);
            const dir = timedDir(code);

            // Keep the source image and the settings to edit the wallpaper later.
            const ext = this._sourcePath.match(/\.[^./]+$/)?.[0].toLowerCase() ?? '';
            const source = `source${ext}`;
            Gio.File.new_for_path(this._sourcePath).copy(
                Gio.File.new_for_path(GLib.build_filenamev([tmpDir, source])),
                Gio.FileCopyFlags.NONE, null, null);
            writeText(GLib.build_filenamev([tmpDir, 'project.json']), `${JSON.stringify({
                name,
                source,
                transitionMinutes: this._transitionRow.value,
                variants: this._variants.map(v => Object.fromEntries(
                    ['label', 'hour', ...TONE_KEYS].map(key => [key, v[key]]))),
            }, null, 2)}\n`);

            // New file names on each save, so GNOME can't show cached frames.
            const stamp = GLib.get_real_time().toString(36);
            const full = pixbufToImage(this._source.full);
            const output = new Uint8Array(full.pixels.length);
            const frames = [];
            for (const [i, variant] of this._variants.entries()) {
                this._createButton.label = format(_('Creating… {current}/{total}'), {
                    current: i + 1,
                    total: this._variants.length,
                });
                // eslint-disable-next-line no-await-in-loop
                await idle();
                const file = `${code}-${stamp}-${i + 1}.jpeg`;
                imageToPixbuf(full, applyTone(full.pixels, full, variant, output))
                    .savev(GLib.build_filenamev([tmpDir, file]), 'jpeg', ['quality'], ['92']);
                frames.push(GLib.build_filenamev([dir, file]));
            }

            const wasCurrent = editedCode !== null && isCurrent({slideshow: slideshowPath(editedCode)});
            uninstallWallpaper(code);
            if (editedCode !== null && editedCode !== code)
                uninstallWallpaper(editedCode);
            Gio.File.new_for_path(tmpDir).move(Gio.File.new_for_path(dir),
                Gio.FileCopyFlags.NONE, null, null);
            this._sourcePath = GLib.build_filenamev([dir, source]);

            const slideshow = writeDynamicWallpaper({
                code,
                name,
                frames,
                hours,
                transitionSeconds: this._transitionRow.value * 60,
            });
            // A renamed wallpaper that was in use must not leave a dangling background.
            const applied = this._applyRow.active || wasCurrent;
            if (applied)
                applyWallpaper(slideshow);
            const message = editedCode !== null
                ? applied ? _('“{name}” saved and applied') : _('“{name}” saved')
                : applied ? _('“{name}” created and applied') : _('“{name}” created');
            this._toast(format(message, {name}));
            this._busy = false;
            this._setEditing({code, name});
            this._onCreated?.();
        } finally {
            deleteRecursive(tmpDir);
            this._busy = false;
            this._createButton.sensitive = true;
            this._createButton.label = this._editing ? SAVE_LABEL() : CREATE_LABEL();
        }
    }
}
