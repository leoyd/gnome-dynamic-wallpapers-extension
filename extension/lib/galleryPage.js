// "Wallpapers" preferences page: installed slideshows and CDN catalog.

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk?version=4.0';
import Adw from 'gi://Adw';

import {CATALOG, fetchPreview, installFromCdn} from './catalog.js';
import {_, format} from './i18n.js';
import {loadThumbnail} from './image.js';
import {
    applyWallpaper, firstFrame, isCurrent, isInstalled, listInstalled,
    uninstallWallpaper,
} from './wallpapers.js';

const THUMB_WIDTH = 112;
const THUMB_HEIGHT = 63;

function makeThumbnail() {
    const picture = new Gtk.Picture({
        content_fit: Gtk.ContentFit.COVER,
        width_request: THUMB_WIDTH,
        height_request: THUMB_HEIGHT,
        valign: Gtk.Align.CENTER,
        css_classes: ['dgw-thumbnail'],
        overflow: Gtk.Overflow.HIDDEN,
    });
    return picture;
}

/** Loads a thumbnail when the main loop is idle so the window opens quickly. */
function fillThumbnailLater(picture, path) {
    GLib.idle_add(GLib.PRIORITY_LOW, () => {
        const texture = path ? loadThumbnail(path, THUMB_WIDTH * 2, THUMB_HEIGHT * 2) : null;
        if (texture)
            picture.set_paintable(texture);
        return GLib.SOURCE_REMOVE;
    });
}

export function confirm(window, heading, body, action) {
    return new Promise(resolve => {
        const dialog = new Adw.AlertDialog({heading, body});
        dialog.add_response('cancel', _('Cancel'));
        dialog.add_response('ok', action);
        dialog.set_response_appearance('ok', Adw.ResponseAppearance.DESTRUCTIVE);
        dialog.set_default_response('cancel');
        dialog.set_close_response('cancel');
        dialog.connect('response', (_d, response) => resolve(response === 'ok'));
        dialog.present(window);
    });
}

export class GalleryPage {
    constructor(window) {
        this._window = window;
        this._installedRows = [];
        this._catalogRows = [];
        this._cancellable = new Gio.Cancellable();

        this.page = new Adw.PreferencesPage({
            title: _('Wallpapers'),
            icon_name: 'preferences-desktop-wallpaper-symbolic',
        });

        this._installedGroup = new Adw.PreferencesGroup({
            title: _('Installed'),
            description: _('Dynamic wallpapers available on this system. They also show up in Settings › Appearance.'),
        });
        this.page.add(this._installedGroup);

        this._catalogGroup = new Adw.PreferencesGroup({
            title: _('Catalog'),
            description: _('Ready-made wallpapers, downloaded from the project CDN.'),
        });
        this.page.add(this._catalogGroup);

        window.connect('close-request', () => {
            this._cancellable.cancel();
            return false;
        });

        this.refresh();
    }

    refresh() {
        this._refreshInstalled();
        this._refreshCatalog();
    }

    _toast(title) {
        this._window.add_toast(new Adw.Toast({title, timeout: 4}));
    }

    _refreshInstalled() {
        for (const row of this._installedRows)
            this._installedGroup.remove(row);
        this._installedRows = [];

        const wallpapers = listInstalled();
        if (!wallpapers.length) {
            const row = new Adw.ActionRow({
                title: _('No Dynamic Wallpapers Installed'),
                subtitle: _('Install one from the catalog or create your own.'),
            });
            this._installedGroup.add(row);
            this._installedRows.push(row);
            return;
        }

        for (const wallpaper of wallpapers) {
            const row = this._makeInstalledRow(wallpaper);
            this._installedGroup.add(row);
            this._installedRows.push(row);
        }
    }

    _makeInstalledRow(wallpaper) {
        const current = isCurrent(wallpaper);
        const row = new Adw.ActionRow({
            title: GLib.markup_escape_text(wallpaper.name, -1),
            subtitle: [
                wallpaper.removable ? _('User') : _('System'),
                current ? _('Active') : null,
            ].filter(Boolean).join(' · '),
        });

        const thumb = makeThumbnail();
        fillThumbnailLater(thumb, firstFrame(wallpaper.slideshow));
        row.add_prefix(thumb);

        if (current) {
            row.add_suffix(new Gtk.Image({
                icon_name: 'object-select-symbolic',
                tooltip_text: _('Current Wallpaper'),
            }));
        } else {
            const apply = new Gtk.Button({
                label: _('Apply'),
                valign: Gtk.Align.CENTER,
                css_classes: ['suggested-action'],
            });
            apply.connect('clicked', () => {
                applyWallpaper(wallpaper.slideshow);
                this._toast(format(_('“{name}” applied'), {name: wallpaper.name}));
                this._refreshInstalled();
            });
            row.add_suffix(apply);
        }

        if (wallpaper.removable) {
            const remove = new Gtk.Button({
                icon_name: 'user-trash-symbolic',
                tooltip_text: _('Remove'),
                valign: Gtk.Align.CENTER,
                css_classes: ['flat'],
            });
            remove.connect('clicked', async () => {
                const ok = await confirm(this._window,
                    format(_('Remove “{name}”?'), {name: wallpaper.name}),
                    _('The images and files of this wallpaper will be deleted.'),
                    _('Remove'));
                if (!ok)
                    return;
                try {
                    uninstallWallpaper(wallpaper.code);
                    this._toast(format(_('“{name}” removed'), {name: wallpaper.name}));
                } catch (e) {
                    this._toast(format(_('Could not remove: {error}'), {error: e.message}));
                }
                this.refresh();
            });
            row.add_suffix(remove);
        }
        return row;
    }

    _refreshCatalog() {
        if (!this._catalogRows.length) {
            for (const entry of CATALOG) {
                const row = this._makeCatalogRow(entry);
                this._catalogGroup.add(row);
                this._catalogRows.push(row);
            }
        }
        for (const row of this._catalogRows)
            row._sync();
    }

    _makeCatalogRow(entry) {
        const row = new Adw.ActionRow({
            title: GLib.markup_escape_text(entry.name, -1),
            subtitle: [
                format(_('Code: {code}'), {code: entry.code}),
                entry.large ? _('⚠ over 500 MB') : null,
            ].filter(Boolean).join(' · '),
        });

        const thumb = makeThumbnail();
        row.add_prefix(thumb);
        fetchPreview(entry, this._cancellable)
            .then(path => fillThumbnailLater(thumb, path))
            .catch(() => thumb.set_paintable(null));

        const credit = new Gtk.Button({
            icon_name: 'web-browser-symbolic',
            tooltip_text: format(_('Credits: {url}'), {url: entry.credit}),
            valign: Gtk.Align.CENTER,
            css_classes: ['flat'],
        });
        credit.connect('clicked', () =>
            new Gtk.UriLauncher({uri: entry.credit}).launch(this._window, null, null));
        row.add_suffix(credit);

        const stack = new Gtk.Stack({
            valign: Gtk.Align.CENTER,
            hhomogeneous: false,
            transition_type: Gtk.StackTransitionType.CROSSFADE,
        });
        const install = new Gtk.Button({label: _('Install')});
        const progress = new Gtk.ProgressBar({width_request: 120, valign: Gtk.Align.CENTER, show_text: true});
        stack.add_named(install, 'button');
        stack.add_named(progress, 'progress');
        row.add_suffix(stack);

        row._sync = () => {
            const installed = isInstalled(entry.code);
            install.label = installed ? _('Reinstall') : _('Install');
            install.css_classes = installed ? [] : ['suggested-action'];
        };

        install.connect('clicked', async () => {
            stack.visible_child_name = 'progress';
            progress.fraction = 0;
            progress.text = _('Connecting…');
            try {
                await installFromCdn(entry.code, {
                    cancellable: this._cancellable,
                    onProgress: fraction => {
                        if (fraction < 0) {
                            progress.pulse();
                            progress.text = _('Downloading…');
                        } else {
                            progress.fraction = fraction;
                            progress.text = `${Math.round(fraction * 100)}%`;
                        }
                    },
                });
                this._toast(format(_('“{name}” installed'), {name: entry.name}));
                this.refresh();
            } catch (e) {
                if (!e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                    this._toast(format(_('Could not install “{name}”: {error}'), {name: entry.name, error: e.message}));
            } finally {
                stack.visible_child_name = 'button';
            }
        });
        return row;
    }
}
