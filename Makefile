UUID := dynamic-gnome-wallpapers@leoyd.github.io
SRC  := extension
ZIP  := build/$(UUID).shell-extension.zip
DOMAIN := dynamic-gnome-wallpapers
POT  := po/$(DOMAIN).pot
JS   := $(shell find $(SRC) -name '*.js' | sort)

.PHONY: pack install uninstall prefs pot update-po clean

pack: $(ZIP)

$(ZIP): $(shell find $(SRC) po -type f)
	mkdir -p build
	gnome-extensions pack $(SRC) --force --out-dir=build --extra-source=lib --podir=../po

install: pack
	gnome-extensions install --force $(ZIP)
	@echo "Installed. On Wayland, log out and back in, then: gnome-extensions enable $(UUID)"

uninstall:
	gnome-extensions uninstall $(UUID)

prefs:
	gnome-extensions prefs $(UUID)

# Regenerate the template after changing UI strings, then update-po.
pot:
	xgettext --from-code=UTF-8 --language=JavaScript --keyword=_ --keyword=N_ \
		--add-comments=Translators --package-name=$(DOMAIN) --output=$(POT) $(JS)

update-po: pot
	for po in po/*.po; do msgmerge --update --backup=none $$po $(POT); done

clean:
	rm -rf build
