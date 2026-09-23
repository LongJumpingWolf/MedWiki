/*
 * Copy this file to content/<id>.js, change the id below (lowercase, hyphens),
 * and add the id to MedWiki.manifest in assets/js/data.js.
 *
 * front matter: subject and chapter ids come from data.js.
 * importance: high | medium | low     status: draft | review | revised
 */
MedWiki.define("template-id", `---
title: Page title
subject: pharmacology
chapter: cvs
kind: Drug monograph
aliases: ABBR, Other name
tags: drug, PYQ
importance: medium
status: draft
edited: 2026-01-01
---
::: definition
One-line definition.
:::

## Overview

Explain it here. Link other pages with [[Page title]] or [[Page title|custom label]].

::: pearl
A ==high-yield== fact.
:::

## Previous questions

::: pyq LAQ · 2024
Question text.
:::
`);
