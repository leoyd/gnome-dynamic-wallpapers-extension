// Shared helpers (usable from both the shell and the preferences process):
// discovery, application and removal of GNOME slideshow wallpapers, and
// generation of the slideshow XML files. Only GLib/Gio are imported here.

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

// Placeholder used by the CDN zips (see install.sh) for the install prefix.
export const PLACEHOLDER = '__LOCATION__';

const BACKGROUND_SCHEMA = 'org.gnome.desktop.background';
const decoder = new TextDecoder();

export function userDataDir() {
    return GLib.get_user_data_dir();
}

export function backgroundsDir(base = userDataDir()) {
    return GLib.build_filenamev([base, 'backgrounds', 'gnome']);
}

export function propertiesDir(base = userDataDir()) {
    return GLib.build_filenamev([base, 'gnome-background-properties']);
}

export function timedDir(code) {
    return GLib.build_filenamev([backgroundsDir(), `${code}-timed`]);
}

export function slideshowPath(code) {
    return GLib.build_filenamev([backgroundsDir(), `${code}-timed.xml`]);
}

export function propertiesPath(code) {
    return GLib.build_filenamev([propertiesDir(), `${code}.xml`]);
}

/** Turns a free-form name into a theme code safe for file names. */
export function sanitizeCode(name) {
    return name.trim()
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/[^A-Za-z0-9_-]+/g, '_')
        .replace(/^_+|_+$/g, '');
}

export function readText(path) {
    const [, bytes] = GLib.file_get_contents(path);
    return decoder.decode(bytes);
}

export function writeText(path, text) {
    GLib.mkdir_with_parents(GLib.path_get_dirname(path), 0o755);
    GLib.file_set_contents(path, text);
}

export function xmlEscape(text) {
    return String(text)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function xmlUnescape(text) {
    return text
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
        .replace(/&amp;/g, '&');
}

function tagValue(block, tag) {
    const match = block.match(new RegExp(`<${tag}>\\s*([^<]*?)\\s*</${tag}>`));
    return match ? xmlUnescape(match[1]) : null;
}

/** Deletes a file or a directory tree, ignoring missing paths. */
export function deleteRecursive(path) {
    const file = Gio.File.new_for_path(path);
    const type = file.query_file_type(Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
    if (type === Gio.FileType.UNKNOWN)
        return;
    if (type === Gio.FileType.DIRECTORY) {
        const children = file.enumerate_children('standard::name',
            Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
        let info;
        while ((info = children.next_file(null)))
            deleteRecursive(GLib.build_filenamev([path, info.get_name()]));
        children.close(null);
    }
    file.delete(null);
}

/** First image referenced by a slideshow XML, used as its thumbnail. */
export function firstFrame(slideshow) {
    try {
        const text = readText(slideshow);
        const match = text.match(/<(?:file|from)>\s*([^<\s][^<]*?)\s*<\/(?:file|from)>/);
        return match ? xmlUnescape(match[1]) : null;
    } catch {
        return null;
    }
}

/**
 * Lists the slideshow ("dynamic") wallpapers declared in
 * gnome-background-properties, user entries first.
 */
export function listInstalled() {
    const user = userDataDir();
    const bases = [user, ...GLib.get_system_data_dirs()];
    const result = [];
    const seen = new Set();

    for (const base of bases) {
        const dir = Gio.File.new_for_path(propertiesDir(base));
        let children;
        try {
            children = dir.enumerate_children('standard::name',
                Gio.FileQueryInfoFlags.NONE, null);
        } catch {
            continue;
        }

        const names = [];
        let info;
        while ((info = children.next_file(null)))
            names.push(info.get_name());
        children.close(null);

        for (const fileName of names.filter(n => n.endsWith('.xml')).sort()) {
            const propsPath = GLib.build_filenamev([dir.get_path(), fileName]);
            let text;
            try {
                text = readText(propsPath);
            } catch {
                continue;
            }

            for (const block of text.match(/<wallpaper[\s>][\s\S]*?<\/wallpaper>/g) ?? []) {
                if (/deleted="true"/.test(block))
                    continue;
                const slideshow = tagValue(block, 'filename');
                if (!slideshow?.endsWith('.xml') || seen.has(slideshow))
                    continue;
                if (!GLib.file_test(slideshow, GLib.FileTest.EXISTS))
                    continue;
                seen.add(slideshow);

                const code = fileName.slice(0, -'.xml'.length);
                result.push({
                    code,
                    name: tagValue(block, 'name') ?? code,
                    slideshow,
                    propsPath,
                    removable: base === user && slideshow === slideshowPath(code),
                });
            }
        }
    }
    return result;
}

export function isInstalled(code) {
    return GLib.file_test(slideshowPath(code), GLib.FileTest.EXISTS);
}

export function currentWallpaperUri() {
    const settings = new Gio.Settings({schema_id: BACKGROUND_SCHEMA});
    return settings.get_string('picture-uri');
}

export function isCurrent(wallpaper) {
    return GLib.filename_to_uri(wallpaper.slideshow, null) === currentWallpaperUri();
}

/** Sets a slideshow as the desktop background for both light and dark styles. */
export function applyWallpaper(slideshow) {
    const uri = GLib.filename_to_uri(slideshow, null);
    const settings = new Gio.Settings({schema_id: BACKGROUND_SCHEMA});
    settings.set_string('picture-uri', uri);
    settings.set_string('picture-uri-dark', uri);
    settings.set_string('picture-options', 'zoom');
}

/** Removes a wallpaper installed in the user data dir. */
export function uninstallWallpaper(code) {
    deleteRecursive(timedDir(code));
    deleteRecursive(slideshowPath(code));
    deleteRecursive(propertiesPath(code));
}

/**
 * Computes the daily schedule of a slideshow. Each variant is fully visible
 * at its hour, stays static, then fades into the next one so that the next
 * variant is fully visible exactly at its own hour.
 *
 * @param {number[]} hours - distinct hours (0-24), sorted ascending
 * @param {number} transitionSeconds - wanted fade duration
 * @returns {{start: number, static: number, transition: number}[]} seconds
 */
export function buildSchedule(hours, transitionSeconds) {
    const n = hours.length;
    return hours.map((hour, i) => {
        const gap = n === 1 ? 86400 : ((hours[(i + 1) % n] - hour + 24) % 24) * 3600;
        const transition = n === 1 ? 0 : Math.min(transitionSeconds, gap);
        return {start: hour * 3600, static: gap - transition, transition};
    });
}

/**
 * Which variants are visible at a given second of the day.
 *
 * @returns {{from: number, to: number, progress: number}}
 */
export function scheduleAt(schedule, secondOfDay) {
    let offset = ((secondOfDay - schedule[0].start) % 86400 + 86400) % 86400;
    for (let i = 0; i < schedule.length; i++) {
        const seg = schedule[i];
        const next = (i + 1) % schedule.length;
        if (offset < seg.static)
            return {from: i, to: i, progress: 0};
        offset -= seg.static;
        if (offset < seg.transition)
            return {from: i, to: next, progress: offset / seg.transition};
        offset -= seg.transition;
    }
    return {from: 0, to: 0, progress: 0};
}

function buildSlideshowXml(frames, schedule) {
    const pad = v => String(v).padStart(2, '0');
    const startHour = Math.floor(schedule[0].start / 3600);
    const startMinute = Math.round((schedule[0].start % 3600) / 60);
    const lines = [
        '<background>',
        '  <starttime>',
        '    <year>2020</year>',
        '    <month>01</month>',
        '    <day>01</day>',
        `    <hour>${pad(startHour)}</hour>`,
        `    <minute>${pad(startMinute)}</minute>`,
        '    <second>00</second>',
        '  </starttime>',
    ];
    schedule.forEach((seg, i) => {
        const file = xmlEscape(frames[i]);
        const next = xmlEscape(frames[(i + 1) % frames.length]);
        if (seg.static > 0) {
            lines.push('  <static>',
                `    <duration>${seg.static.toFixed(1)}</duration>`,
                `    <file>${file}</file>`,
                '  </static>');
        }
        if (seg.transition > 0) {
            lines.push('  <transition type="overlay">',
                `    <duration>${seg.transition.toFixed(1)}</duration>`,
                `    <from>${file}</from>`,
                `    <to>${next}</to>`,
                '  </transition>');
        }
    });
    lines.push('</background>', '');
    return lines.join('\n');
}

function buildPropertiesXml(name, slideshow) {
    return [
        '<?xml version="1.0"?>',
        '<!DOCTYPE wallpapers SYSTEM "gnome-wp-list.dtd">',
        '<wallpapers>',
        '  <wallpaper deleted="false">',
        `    <name>${xmlEscape(name)}</name>`,
        `    <filename>${xmlEscape(slideshow)}</filename>`,
        `    <filename-dark>${xmlEscape(slideshow)}</filename-dark>`,
        '    <options>zoom</options>',
        '    <shade_type>solid</shade_type>',
        '    <pcolor>#3465a4</pcolor>',
        '    <scolor>#000000</scolor>',
        '  </wallpaper>',
        '</wallpapers>',
        '',
    ].join('\n');
}

/**
 * Writes the slideshow and properties XML of a generated wallpaper whose
 * frames are already in timedDir(code).
 *
 * @param {object} args
 * @param {string} args.code - theme code
 * @param {string} args.name - display name
 * @param {string[]} args.frames - image paths, in the same order as hours
 * @param {number[]} args.hours - sorted, distinct hours
 * @param {number} args.transitionSeconds - fade duration
 * @returns {string} the slideshow path
 */
export function writeDynamicWallpaper({code, name, frames, hours, transitionSeconds}) {
    const slideshow = slideshowPath(code);
    writeText(slideshow, buildSlideshowXml(frames, buildSchedule(hours, transitionSeconds)));
    writeText(propertiesPath(code), buildPropertiesXml(name, slideshow));
    return slideshow;
}
