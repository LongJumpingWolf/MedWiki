/*
 * Loads every article in MedWiki.manifest as a classic script (works from
 * file:// as well as a server). Must run after core.js and data.js.
 */
(function () {
  /* Chapters added from the editor (written by serve.js). */
  var fresh = "?t=" + Date.now(); /* articles are your data: never serve a cached copy */
  document.write('<script src="content/_chapters.js' + fresh + '"><\/script>');
  document.write('<script src="content/_structure.js' + fresh + '"><\/script>');
  document.write('<script src="content/_bites.js' + fresh + '"><\/script>');
  (MedWiki.manifest || []).forEach(function (id) {
    document.write('<script src="content/' + id + '.js' + fresh + '"><\/script>');
  });
})();
