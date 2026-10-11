<div align="center">

<img src="https://user-images.githubusercontent.com/54291836/130308064-3b82d8c5-2ccf-4351-ae35-6b197daee3f1.gif" width="640" alt="Dynamic wallpaper changing throughout the day">

# Dynamic Wallpapers for GNOME

**A GNOME Shell extension for wallpapers that follow the time of day.**
Install ready-made dynamic wallpapers in one click, or turn any image into your own.

[![GNOME Shell](https://img.shields.io/badge/GNOME_Shell-47_→_51-4A86CF?logo=gnome&logoColor=white)](https://extensions.gnome.org/)
[![GJS](https://img.shields.io/badge/GJS-ES_modules-F7DF1E?logo=javascript&logoColor=black)](https://gjs.guide/)
[![GTK4 · libadwaita](https://img.shields.io/badge/GTK4-libadwaita-3584E4)](https://gnome.pages.gitlab.gnome.org/libadwaita/)
[![Wayland · X11](https://img.shields.io/badge/Wayland_·_X11-supported-2ea44f)](#installation)
[![Languages](https://img.shields.io/badge/i18n-English_·_Français-blueviolet)](po/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

[Features](#features) •
[Installation](#installation) •
[Usage](#usage) •
[Catalog](#wallpaper-catalog) •
[Development](#development) •
[Credits](#credits)

</div>

---

## Features

| | |
|---|---|
| 🖼️ **Catalog** | Install ready-made dynamic wallpapers (ported from macOS) with one click. |
| 🎨 **Create** | Drop any image and turn it into a dynamic wallpaper: each variant gets its own color tone (brightness, contrast, saturation, tint) shown at a given hour. Preview it, or simulate a whole day with transitions. |
| ✏️ **Edit** | Reopen a wallpaper you created to change its image, variants, hours or transition. |
| 🔀 **Panel menu** | Switch between your installed dynamic wallpapers from the top bar. |
| ⚙️ **Native** | Wallpapers are standard GNOME slideshows, so they also show up in **Settings › Appearance**. |

The interface follows the system language (English and French).

## Installation

### Requirements

- GNOME Shell **47 to 51**
- `make`, `gettext` (`msgfmt`) and `gnome-extensions` (shipped with GNOME Shell)
- `unzip`, to install wallpapers from the catalog

### From source

```bash
git clone https://github.com/leoyd/gnome-dynamic-wallpapers-extension.git
cd gnome-dynamic-wallpapers-extension
make install   # packs and installs the extension for the current user
```

Then enable it:

> [!IMPORTANT]
> **Wayland**: log out and back in first, GNOME Shell only detects new extensions at login.
> **X11**: you can instead restart GNOME Shell with <kbd>Alt</kbd>+<kbd>F2</kbd>, `r`, <kbd>Enter</kbd>.

```bash
gnome-extensions enable gnome-dynamic-wallpapers@leoyd.github.io
```

You can also enable it from the **Extensions** app. To update, pull the latest changes and run `make install` again.

### Uninstall

```bash
make uninstall   # installed wallpapers are kept
```

## Usage

Click the wallpaper icon in the top bar:

- the installed dynamic wallpapers are listed, the active one is checked: click one to apply it;
- **Manage and Create Wallpapers…** opens the preferences window (also reachable with `make prefs` or from the Extensions app).

<details open>
<summary><b>Wallpapers page</b></summary>

- **Installed**: your dynamic wallpapers (user and system ones). **Apply** sets one as the current wallpaper, **Edit** reopens a wallpaper you created in the *Create* page, **Remove** deletes its files (user wallpapers only).
- **Catalog**: ready-made wallpapers. **Install** downloads one into `~/.local/share`.

</details>

<details open>
<summary><b>Create page</b></summary>

1. Drop an image on the *Source Image* area, or click **Choose an Image…** (JPEG, PNG, WebP… the original resolution is kept).
2. In *Variants*, select a variant to edit its name, the **hour** at which it is fully shown, and its tone. Add or remove variants, or restore the defaults (night, dawn, morning, noon, sunset, dusk).
3. *Preview* shows the selected variant; enable **Simulate a Day** to see the wallpaper at any time, transitions included, or press play to run through the whole day.
4. In *Creation*, name the wallpaper, set the transition length and click **Create**. With **Apply After Creation**, it becomes your wallpaper right away.

A variant is fully visible at its hour, stays static, then fades into the next one, finishing at the next variant's hour (the fade is capped by the gap between the two hours).

</details>

<details>
<summary><b>Editing a wallpaper</b></summary>

Click **Edit** next to a wallpaper you created: its image, variants, name and transition are loaded back in the *Create* page. Adjust anything (you can even drop another image), then click **Save Changes**; renaming it replaces the old one. Click **New Wallpaper** in the banner to leave edit mode.

</details>

<details>
<summary><b>Where files go</b></summary>

| Path | Content |
|---|---|
| `~/.local/share/backgrounds/gnome/<code>-timed/` | frames (plus `source.*` and `project.json` for created wallpapers) |
| `~/.local/share/backgrounds/gnome/<code>-timed.xml` | slideshow timings |
| `~/.local/share/gnome-background-properties/<code>.xml` | entry for GNOME Settings |

</details>

## Wallpaper catalog

The default catalog is the wallpaper collection of [**manishprivet/dynamic-gnome-wallpapers**](https://github.com/manishprivet/dynamic-gnome-wallpapers) by [Manish Kumar](https://github.com/manishprivet), downloaded from its CDN.

> [!NOTE]
> The extension checks the CDN each time the preferences window opens. Wallpapers that are no longer available are simply not listed, and if the CDN is down the *Catalog* section is hidden. Creating, editing and switching wallpapers keep working.

| | | |
|:---:|:---:|:---:|
| <img src="https://user-images.githubusercontent.com/54291836/126888360-48c90397-49fb-44ed-af52-f793178e1f63.gif" width="260"><br>**Lakeside**<br><sub>[Lakeside Sunrise, Dribbble](https://dribbble.com/shots/1816328-Lakeside-Sunrise)</sub> | <img src="https://user-images.githubusercontent.com/54291836/126893468-8ac4590e-ceea-40a2-a938-3e4db0f6ddf9.gif" width="260"><br>**A Certain Magical Index** ⚠️ 500 MB+<br><sub>[legend](https://dynamicwallpaper.club/u/legend)</sub> | <img src="https://user-images.githubusercontent.com/54291836/126888357-3dfde85b-b371-4d41-9695-d569c1424a48.gif" width="260"><br>**Exodus**<br><sub>[Juanra](https://dynamicwallpaper.club/u/Juanra)</sub> |
| <img src="https://user-images.githubusercontent.com/54291836/126888359-de35b414-cc69-494b-8065-487de5f22924.gif" width="260"><br>**Minimal Mojave**<br><sub>[octaviotti](https://dynamicwallpaper.club/u/octaviotti)</sub> | <img src="https://user-images.githubusercontent.com/54291836/126888358-ac91b4f6-0685-4fd3-8928-db4eebc75434.gif" width="260"><br>**Mojave**<br><sub>[Apple, via r/apple](https://www.reddit.com/r/apple/comments/8oz25c/all_16_full_resolution_macos_mojave_dynamic/)</sub> | <img src="https://user-images.githubusercontent.com/54291836/126888353-e1eec7c1-f5c0-48cf-b4dd-c987e11b9b69.gif" width="260"><br>**Mojave V2**<br><sub>[WeighingDog](https://dynamicwallpaper.club/u/WeighingDog)</sub> |
| <img src="https://user-images.githubusercontent.com/54291836/126888350-d954464c-5838-40d6-a585-5c622f1e22c8.gif" width="260"><br>**Big Sur Beach**<br><sub>[DavidPicnic](https://dynamicwallpaper.club/u/DavidPicnic)</sub> | <img src="https://user-images.githubusercontent.com/54291836/126888351-023dbd48-7a49-442b-b909-91f995ed749e.gif" width="260"><br>**Firewatch**<br><sub>[Jagoba](https://dynamicwallpaper.club/u/Jagoba)</sub> | <img src="https://user-images.githubusercontent.com/54291836/126888345-10183721-0984-40c3-82bf-20c147897c6c.gif" width="260"><br>**Lakeside 2**<br><sub>[vitaobr92](https://dynamicwallpaper.club/u/vitaobr92)</sub> |
| <img src="https://user-images.githubusercontent.com/54291836/127216821-83a15fe9-ebf3-4e8a-ae98-49dc9f4b792b.gif" width="260"><br>**Big Sur**<br><sub>[jalbans17](https://dynamicwallpaper.club/u/jalbans17)</sub> | <img src="https://user-images.githubusercontent.com/54291836/127258707-7895e748-ddc8-4e06-8767-df7609e834bd.gif" width="260"><br>**Fuji**<br><sub>[MaxKulakov](https://dynamicwallpaper.club/u/MaxKulakov)</sub> | <img src="https://user-images.githubusercontent.com/54291836/130307589-cfae49ee-8199-4da1-a505-4a3947ef0663.gif" width="260"><br>**Catalina**<br><sub>[wallpapyrus](https://dynamicwallpaper.club/u/wallpapyrus)</sub> |

## Development

```bash
make pack       # build/<uuid>.shell-extension.zip
make install    # pack + install for the current user
make prefs      # open the preferences window
make update-po  # regenerate po/*.pot and merge it into po/*.po after changing UI strings
```

To add a translation, copy `po/gnome-dynamic-wallpapers.pot` to `po/<lang>.po` and translate it.

## Credits

- **Wallpaper collection & CDN**: [manishprivet/dynamic-gnome-wallpapers](https://github.com/manishprivet/dynamic-gnome-wallpapers) by [Manish Kumar](https://github.com/manishprivet) and [its contributors](https://github.com/manishprivet/dynamic-gnome-wallpapers/graphs/contributors). This extension started as a fork of that project.
- **Wallpaper artists**: each wallpaper is credited above and on its row in the catalog. Most come from [dynamicwallpaper.club](https://dynamicwallpaper.club/) and macOS.
- **Original inspiration**: [b1izzard-34/Dynamic-gnome-wallpapers](https://github.com/b1izzard-34/Dynamic-gnome-wallpapers).

<a href="https://github.com/manishprivet/dynamic-gnome-wallpapers/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=manishprivet/dynamic-gnome-wallpapers" alt="Contributors of manishprivet/dynamic-gnome-wallpapers">
</a>

## License

[MIT](LICENSE) © 2026 leoyd, © 2021 Manish Kumar. The wallpapers belong to their respective authors.
