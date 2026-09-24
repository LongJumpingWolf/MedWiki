# Dictionaries

The editor's spell checker (assets/js/spell.js) uses only these files. The browser's own dictionary is never used.

- medical.txt: English medical terms (drugs, anatomy, organisms, diseases), from Glutanimate's
  wordlist-medicalterms-en, itself merged from OpenMedSpel (e-MedTools) and Med-Spel-Chek (Rajasekharan N.).
  GNU GPL v3. https://github.com/glutanimate/wordlist-medicalterms-en
- en.aff, en.dic: Hunspell en_US (SCOWL), see https://wordlist.sourceforge.net for its licence.
- ../vendor/nspell.min.js: nspell (MIT), a Hunspell-compatible checker, bundled with esbuild.

Words you add with "Add to dictionary" are stored in this browser only (localStorage, key medwiki:dict).
