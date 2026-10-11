import Gdk from 'gi://Gdk?version=4.0';
import Gtk from 'gi://Gtk?version=4.0';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {CreatorPage} from './lib/creatorPage.js';
import {GalleryPage} from './lib/galleryPage.js';

const CSS = `
.dgw-drop-zone {
    border: 2px dashed alpha(currentColor, 0.25);
    border-radius: 12px;
    padding: 32px 24px;
    transition: all 150ms ease-out;
}
.dgw-drop-zone.dgw-drop-compact { padding: 12px 24px; }
.dgw-drop-zone.dgw-drop-hover {
    border-color: @accent_color;
    background-color: alpha(@accent_bg_color, 0.12);
}
.dgw-thumbnail { border-radius: 6px; }
.dgw-preview { border-radius: 12px; }
.dgw-variant { padding: 6px; }
`;

export default class DynamicWallpapersPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const provider = new Gtk.CssProvider();
        provider.load_from_string(CSS);
        Gtk.StyleContext.add_provider_for_display(Gdk.Display.get_default(),
            provider, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);

        window.set_default_size(900, 860);
        window.search_enabled = false;

        const gallery = new GalleryPage(window, {
            onEdit: wallpaper => {
                if (creator.edit(wallpaper))
                    window.set_visible_page(creator.page);
            },
            onRemoved: wallpaper => creator.forget(wallpaper),
        });
        const creator = new CreatorPage(window, {onCreated: () => gallery.refresh()});
        window.add(gallery.page);
        window.add(creator.page);
    }
}
