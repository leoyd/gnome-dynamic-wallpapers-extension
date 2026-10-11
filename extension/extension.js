// Panel menu listing the installed dynamic wallpapers for quick switching.

import GObject from 'gi://GObject';
import St from 'gi://St';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {applyWallpaper, isCurrent, listInstalled} from './lib/wallpapers.js';
import {_} from './lib/i18n.js';

const Indicator = GObject.registerClass(
class DynamicWallpapersIndicator extends PanelMenu.Button {
    _init(extension) {
        super._init(0.0, extension.metadata.name);

        this.add_child(new St.Icon({
            icon_name: 'preferences-desktop-wallpaper-symbolic',
            style_class: 'system-status-icon',
        }));

        this._section = new PopupMenu.PopupMenuSection();
        this.menu.addMenuItem(this._section);
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this.menu.addAction(_('Manage and Create Wallpapers…'), () => extension.openPreferences());

        this.menu.connectObject('open-state-changed', (_menu, open) => {
            if (open)
                this._rebuild();
        }, this);
        this._rebuild();
    }

    _rebuild() {
        this._section.removeAll();

        let wallpapers = [];
        try {
            wallpapers = listInstalled();
        } catch (e) {
            console.error(`Dynamic Wallpapers: ${e.message}`);
        }

        if (!wallpapers.length) {
            const item = new PopupMenu.PopupMenuItem(_('No Dynamic Wallpapers'), {reactive: false});
            this._section.addMenuItem(item);
            return;
        }

        for (const wallpaper of wallpapers) {
            const item = new PopupMenu.PopupMenuItem(wallpaper.name);
            item.setOrnament(isCurrent(wallpaper) ? PopupMenu.Ornament.CHECK : PopupMenu.Ornament.NONE);
            item.connect('activate', () => applyWallpaper(wallpaper.slideshow));
            this._section.addMenuItem(item);
        }
    }
});

export default class DynamicWallpapersExtension extends Extension {
    enable() {
        this._indicator = new Indicator(this);
        Main.panel.addToStatusArea(this.uuid, this._indicator);
    }

    disable() {
        this._indicator?.destroy();
        this._indicator = null;
    }
}
