// Gettext helpers usable from every module (shell, preferences and plain gjs).
// The domain is bound by the extension system from metadata.json.

import Gettext from 'gettext';

export const DOMAIN = 'gnome-dynamic-wallpapers';

export const _ = text => Gettext.dgettext(DOMAIN, text);

export const ngettext = (singular, plural, n) => Gettext.dngettext(DOMAIN, singular, plural, n);

/** Replaces `{key}` placeholders, so translators can reorder them. */
export const format = (template, values) =>
    template.replace(/\{(\w+)\}/g, (match, key) => key in values ? String(values[key]) : match);
