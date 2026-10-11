// GdkPixbuf <-> raw buffer <-> Gdk.Texture helpers. Preferences process only.

import GLib from 'gi://GLib';
import Gdk from 'gi://Gdk?version=4.0';
import GdkPixbuf from 'gi://GdkPixbuf';

// Larger sources are downscaled before export to keep memory and time sane.
const MAX_EXPORT_WIDTH = 7680;

/** Raw pixels of a pixbuf plus the layout needed to process them. */
export function pixbufToImage(pixbuf) {
    return {
        pixels: pixbuf.read_pixel_bytes().toArray(),
        width: pixbuf.get_width(),
        height: pixbuf.get_height(),
        rowstride: pixbuf.get_rowstride(),
        channels: pixbuf.get_n_channels(),
    };
}

export function imageToPixbuf(img, pixels = img.pixels) {
    return GdkPixbuf.Pixbuf.new_from_bytes(new GLib.Bytes(pixels),
        GdkPixbuf.Colorspace.RGB, img.channels === 4, 8,
        img.width, img.height, img.rowstride);
}

export function imageToTexture(img, pixels = img.pixels) {
    const format = img.channels === 4
        ? Gdk.MemoryFormat.R8G8B8A8 : Gdk.MemoryFormat.R8G8B8;
    return Gdk.MemoryTexture.new(img.width, img.height, format,
        new GLib.Bytes(pixels), img.rowstride);
}

function scaleToWidth(pixbuf, width) {
    if (pixbuf.get_width() <= width)
        return pixbuf;
    const height = Math.max(1, Math.round(pixbuf.get_height() * width / pixbuf.get_width()));
    return pixbuf.scale_simple(width, height, GdkPixbuf.InterpType.BILINEAR);
}

/**
 * Loads an image as an opaque RGB pixbuf (EXIF orientation applied, alpha
 * flattened on black) along with downscaled copies for previews.
 */
export function loadSource(path, previewWidth, thumbWidth) {
    let pixbuf = GdkPixbuf.Pixbuf.new_from_file(path).apply_embedded_orientation();
    pixbuf = scaleToWidth(pixbuf, MAX_EXPORT_WIDTH);

    if (pixbuf.get_has_alpha()) {
        const flat = GdkPixbuf.Pixbuf.new(GdkPixbuf.Colorspace.RGB, false, 8,
            pixbuf.get_width(), pixbuf.get_height());
        flat.fill(0x000000ff);
        pixbuf.composite(flat, 0, 0, pixbuf.get_width(), pixbuf.get_height(),
            0, 0, 1, 1, GdkPixbuf.InterpType.BILINEAR, 255);
        pixbuf = flat;
    }

    return {
        full: pixbuf,
        preview: pixbufToImage(scaleToWidth(pixbuf, previewWidth)),
        thumb: pixbufToImage(scaleToWidth(pixbuf, thumbWidth)),
    };
}

/** Small texture for list thumbnails, or null if the file can't be read. */
export function loadThumbnail(path, width, height) {
    try {
        const pixbuf = GdkPixbuf.Pixbuf.new_from_file_at_scale(path, width, height, true);
        return imageToTexture(pixbufToImage(pixbuf));
    } catch {
        return null;
    }
}
