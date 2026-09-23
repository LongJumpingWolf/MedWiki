/*
 * Site structure and the list of built-in articles.
 *
 * Hierarchy is Subject → Chapter → Article → Heading. Tags are separate
 * (set per article) and never replace this hierarchy.
 *
 * To add an article file: create content/<id>.js (copy content/_template.js)
 * and add its id to `manifest`. Pages created in the browser need no manifest
 * entry; they are stored locally until you export them (see README).
 */
window.MedWiki = window.MedWiki || {};

MedWiki.subjectData = [
  {
    id: "pharmacology",
    title: "Pharmacology",
    chapters: [
      { id: "general", title: "General pharmacology" },
      { id: "ans", title: "Autonomic nervous system" },
      { id: "cvs", title: "Cardiovascular system" },
      { id: "cns", title: "Central nervous system" },
      { id: "antimicrobials", title: "Antimicrobials" },
    ],
  },
  {
    id: "pathology",
    title: "Pathology",
    chapters: [
      { id: "general", title: "General pathology" },
      { id: "hematology", title: "Hematology" },
      { id: "cvs", title: "Cardiovascular system" },
      { id: "kidney", title: "Kidney" },
    ],
  },
  {
    id: "microbiology",
    title: "Microbiology",
    chapters: [
      { id: "immunology", title: "Immunology" },
      { id: "bacteriology", title: "Bacteriology" },
      { id: "virology", title: "Virology" },
    ],
  },
];

MedWiki.manifest = [];
