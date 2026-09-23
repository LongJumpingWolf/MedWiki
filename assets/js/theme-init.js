/* Runs synchronously in <head> so theme and revision mode apply before first paint. */
(function () {
  function read(key) {
    try {
      return JSON.parse(localStorage.getItem(key));
    } catch (e) {
      return null;
    }
  }
  var root = document.documentElement;
  var theme = read("medwiki:theme");
  if (!theme && window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches) theme = "dark";
  if (theme === "dark") root.setAttribute("data-theme", "dark");
  if (read("medwiki:revision") === true) root.setAttribute("data-mode", "revision");
  if (read("medwiki:recall") === true) root.setAttribute("data-recall", "on");
})();
