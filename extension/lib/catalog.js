// Default catalog: the wallpapers of the dynamic-gnome-wallpapers project by
// Manish Kumar, hosted on its CDN. Installing one downloads the zip, extracts
// it, replaces the location placeholder and copies the files into the user
// data dir. Preferences process only.

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Soup from 'gi://Soup?version=3.0';

import {_, format} from './i18n.js';
import {
    PLACEHOLDER, backgroundsDir, deleteRecursive, propertiesPath, readText,
    slideshowPath, timedDir, uninstallWallpaper, userDataDir, writeText,
} from './wallpapers.js';

Gio._promisify(Soup.Session.prototype, 'send_async');
Gio._promisify(Soup.Session.prototype, 'send_and_read_async');
Gio._promisify(Gio.InputStream.prototype, 'read_bytes_async');
Gio._promisify(Gio.Subprocess.prototype, 'communicate_utf8_async');

export const CATALOG_SOURCE = {
    author: 'Manish Kumar',
    project: 'dynamic-gnome-wallpapers',
    url: 'https://github.com/manishprivet/dynamic-gnome-wallpapers',
};

const CDN_URL = 'https://cdn.manishk.dev/v2%2F';
const PREVIEW_URL = 'https://user-images.githubusercontent.com/54291836/';
const CHUNK_SIZE = 1024 * 1024;

export const CATALOG = [
    {code: 'Lakeside', name: 'Lakeside', credit: 'https://dribbble.com/shots/1816328-Lakeside-Sunrise', preview: '126888360-48c90397-49fb-44ed-af52-f793178e1f63.gif'},
    {code: 'A_Certain_Magical_Index', name: 'A Certain Magical Index', credit: 'https://dynamicwallpaper.club/u/legend', preview: '126893468-8ac4590e-ceea-40a2-a938-3e4db0f6ddf9.gif', large: true},
    {code: 'Exodus', name: 'Exodus', credit: 'https://dynamicwallpaper.club/u/Juanra', preview: '126888357-3dfde85b-b371-4d41-9695-d569c1424a48.gif'},
    {code: 'Minimal-Mojave', name: 'Minimal Mojave', credit: 'https://dynamicwallpaper.club/u/octaviotti', preview: '126888359-de35b414-cc69-494b-8065-487de5f22924.gif'},
    {code: 'Mojave', name: 'Mojave', credit: 'https://www.reddit.com/r/apple/comments/8oz25c/all_16_full_resolution_macos_mojave_dynamic/', preview: '126888358-ac91b4f6-0685-4fd3-8928-db4eebc75434.gif'},
    {code: 'MojaveV2', name: 'Mojave V2', credit: 'https://dynamicwallpaper.club/u/WeighingDog', preview: '126888353-e1eec7c1-f5c0-48cf-b4dd-c987e11b9b69.gif'},
    {code: 'Big_Sur_Beach', name: 'Big Sur Beach', credit: 'https://dynamicwallpaper.club/u/DavidPicnic', preview: '126888350-d954464c-5838-40d6-a585-5c622f1e22c8.gif'},
    {code: 'Firewatch', name: 'Firewatch', credit: 'https://dynamicwallpaper.club/u/Jagoba', preview: '126888351-023dbd48-7a49-442b-b909-91f995ed749e.gif'},
    {code: 'Lakeside-2', name: 'Lakeside 2', credit: 'https://dynamicwallpaper.club/u/vitaobr92', preview: '126888345-10183721-0984-40c3-82bf-20c147897c6c.gif'},
    {code: 'Big_Sur', name: 'Big Sur', credit: 'https://dynamicwallpaper.club/u/jalbans17', preview: '127216821-83a15fe9-ebf3-4e8a-ae98-49dc9f4b792b.gif'},
    {code: 'Fuji', name: 'Fuji', credit: 'https://dynamicwallpaper.club/u/MaxKulakov', preview: '127258707-7895e748-ddc8-4e06-8767-df7609e834bd.gif'},
    {code: 'Catalina', name: 'Catalina', credit: 'https://dynamicwallpaper.club/u/wallpapyrus', preview: '130307589-cfae49ee-8199-4da1-a505-4a3947ef0663.gif'},
];

let session = null;

function getSession() {
    session ??= new Soup.Session({user_agent: 'dynamic-gnome-wallpapers-extension'});
    return session;
}

function checkStatus(message) {
    const status = message.get_status();
    if (status !== Soup.Status.OK)
        throw new Error(`HTTP ${status} ${message.get_reason_phrase() ?? ''}`.trim());
}

function zipUrl(code) {
    return `${CDN_URL}${encodeURIComponent(code)}.zip`;
}

/**
 * Checks that the zip of a catalog entry is still served by the CDN.
 * Never throws: any network or HTTP problem means unavailable.
 */
export async function isAvailable(entry, cancellable = null) {
    try {
        const message = Soup.Message.new('HEAD', zipUrl(entry.code));
        await getSession().send_and_read_async(message, GLib.PRIORITY_LOW, cancellable);
        const type = message.get_response_headers().get_content_type()[0] ?? '';
        return message.get_status() === Soup.Status.OK && !type.startsWith('text/');
    } catch {
        return false;
    }
}

/** Downloads (once) the animated preview of a catalog entry, returns its path. */
export async function fetchPreview(entry, cancellable = null) {
    const cacheDir = GLib.build_filenamev([GLib.get_user_cache_dir(), 'dynamic-gnome-wallpapers', 'previews']);
    const path = GLib.build_filenamev([cacheDir, `${entry.code}.gif`]);
    if (GLib.file_test(path, GLib.FileTest.EXISTS))
        return path;

    const message = Soup.Message.new('GET', PREVIEW_URL + entry.preview);
    const bytes = await getSession().send_and_read_async(message, GLib.PRIORITY_LOW, cancellable);
    checkStatus(message);
    GLib.mkdir_with_parents(cacheDir, 0o755);
    GLib.file_set_contents(path, bytes.toArray());
    return path;
}

async function download(url, destPath, onProgress, cancellable) {
    const message = Soup.Message.new('GET', url);
    const input = await getSession().send_async(message, GLib.PRIORITY_DEFAULT, cancellable);
    checkStatus(message);

    const total = message.get_response_headers().get_content_length();
    const output = Gio.File.new_for_path(destPath)
        .replace(null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, cancellable);
    let received = 0;
    try {
        for (;;) {
            // eslint-disable-next-line no-await-in-loop
            const bytes = await input.read_bytes_async(CHUNK_SIZE, GLib.PRIORITY_DEFAULT, cancellable);
            const size = bytes.get_size();
            if (size === 0)
                break;
            output.write_all(bytes.toArray(), cancellable);
            received += size;
            onProgress?.(total > 0 ? received / total : -1);
        }
    } finally {
        output.close(null);
        input.close(null);
    }
}

async function extract(zipPath, destDir, cancellable) {
    if (!GLib.find_program_in_path('unzip'))
        throw new Error(_('The “unzip” command is missing, install it to download wallpapers.'));

    const proc = Gio.Subprocess.new(['unzip', '-q', '-o', zipPath, '-d', destDir],
        Gio.SubprocessFlags.STDOUT_SILENCE | Gio.SubprocessFlags.STDERR_PIPE);
    const [, , stderr] = await proc.communicate_utf8_async(null, cancellable);
    if (!proc.get_successful())
        throw new Error(`unzip: ${stderr?.trim() || _('extraction failed')}`);
}

function listDir(path) {
    const names = [];
    const children = Gio.File.new_for_path(path).enumerate_children('standard::name',
        Gio.FileQueryInfoFlags.NONE, null);
    let info;
    while ((info = children.next_file(null)))
        names.push(info.get_name());
    children.close(null);
    return names;
}

/** Finds the directory holding `<code>-timed.xml` (the zip root or a subfolder). */
function findThemeDir(root, code) {
    const marker = `${code}-timed.xml`;
    const queue = [[root, 0]];
    while (queue.length) {
        const [dir, depth] = queue.shift();
        const names = listDir(dir);
        if (names.includes(marker))
            return dir;
        if (depth < 2) {
            for (const name of names) {
                const child = GLib.build_filenamev([dir, name]);
                if (GLib.file_test(child, GLib.FileTest.IS_DIR))
                    queue.push([child, depth + 1]);
            }
        }
    }
    throw new Error(format(_('Invalid archive: {file} not found'), {file: marker}));
}

/**
 * Installs a catalog wallpaper for the current user.
 *
 * @param {string} code - theme code
 * @param {object} [options]
 * @param {Function} [options.onProgress] - called with 0..1, or -1 if unknown
 * @param {Gio.Cancellable} [options.cancellable]
 */
export async function installFromCdn(code, {onProgress = null, cancellable = null} = {}) {
    const tmp = GLib.dir_make_tmp('dynamic-wallpaper-XXXXXX');
    try {
        const zipPath = GLib.build_filenamev([tmp, `${code}.zip`]);
        const extractDir = GLib.build_filenamev([tmp, 'content']);
        await download(zipUrl(code), zipPath, onProgress, cancellable);
        await extract(zipPath, extractDir, cancellable);

        const srcDir = findThemeDir(extractDir, code);
        const location = userDataDir();
        const fix = name => readText(GLib.build_filenamev([srcDir, name])).replaceAll(PLACEHOLDER, location);
        const slideshow = fix(`${code}-timed.xml`);
        const properties = fix(`${code}.xml`);

        uninstallWallpaper(code);
        const dest = timedDir(code);
        GLib.mkdir_with_parents(dest, 0o755);
        for (const name of listDir(srcDir)) {
            if (!name.startsWith(code) || !/\.(jpe?g|png|webp|jxl)$/i.test(name))
                continue;
            Gio.File.new_for_path(GLib.build_filenamev([srcDir, name])).copy(
                Gio.File.new_for_path(GLib.build_filenamev([dest, name])),
                Gio.FileCopyFlags.OVERWRITE, cancellable, null);
        }
        GLib.mkdir_with_parents(backgroundsDir(), 0o755);
        writeText(slideshowPath(code), slideshow);
        writeText(propertiesPath(code), properties);
    } finally {
        deleteRecursive(tmp);
    }
}
