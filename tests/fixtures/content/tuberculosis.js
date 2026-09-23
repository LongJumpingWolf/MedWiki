MedWiki.define("tuberculosis", `---
title: Tuberculosis
subject: microbiology
chapter: bacteriology
kind: Disease
aliases: TB, Koch's disease, Mycobacterium tuberculosis infection
tags: disease, organism, mock, must-revise
importance: high
status: review
edited: 2026-09-19
---
::: summary
**Tuberculosis** is a chronic ==caseating granulomatous== infection caused by *Mycobacterium tuberculosis*, spread by airborne droplet nuclei. It usually affects the lungs.

::: flow
Inhaled bacilli -> Alveolar macrophage -> Th1 response (IFN-γ) -> Caseating granuloma -> Healing, or progression
:::
:::

## The organism

*M. tuberculosis* is a slow-growing, obligate aerobic, non-motile bacillus. Its cell wall is rich in **mycolic acid**, which makes it acid-fast: it holds carbol fuchsin even after acid-alcohol. See the [[Ziehl–Neelsen stain]].

- Generation time is about 15–20 hours, so culture takes weeks
- Grows on Löwenstein–Jensen medium (egg-based, green from malachite green)
- Virulence factors include cord factor and sulfatides, which block phagosome–lysosome fusion

## Pathogenesis

Bacilli reach alveoli and are taken up by macrophages, where they survive and multiply. Infected macrophages present antigen and release IL-12, driving a **Th1** response. IFN-γ activates macrophages, and TNF-α maintains the granuloma. Tissue damage comes mostly from the immune response (type IV hypersensitivity), not from the bacillus itself.

::: pearl
Defects in the IL-12/IFN-γ axis, and anti-TNF drugs such as infliximab, ==reactivate latent TB==.
:::

The resulting lesion is a caseating [[Granulomatous inflammation|granuloma]].

## Primary and secondary TB

| | Primary TB | Secondary (reactivation) TB |
|---|---|---|
| Host | Previously unexposed, often a child | Previously sensitised |
| Site | Subpleural, lower part of upper lobe or upper part of lower lobe | Apex of the lung |
| Lesion | Ghon focus; with hilar nodes = Ghon complex | Assmann focus, then cavitation |
| Healing | Fibrosis and calcification (Ranke complex) | Often progressive |

### Key terms

- **Ghon focus:** the peripheral parenchymal lesion of primary TB
- **Ghon complex:** Ghon focus plus caseous hilar lymph node
- **Ranke complex:** a calcified Ghon complex
- **Miliary TB:** haematogenous spread with millet-seed-sized lesions in many organs

## Clinical features

::: clinical
- Cough for more than 2 weeks, sometimes with haemoptysis
- Evening fever and night sweats
- Weight loss and anorexia
- Extrapulmonary disease: lymph nodes, pleura, bones and spine, meninges, gut, genitourinary tract
:::

## Diagnosis

| Test | What it shows | Note |
|---|---|---|
| Sputum smear | Acid-fast bacilli | Needs roughly 10,000 bacilli/mL |
| CBNAAT / Xpert MTB/RIF | *M. tuberculosis* DNA and rifampicin resistance | Result in about 2 hours |
| Culture (LJ, MGIT) | Live organism, drug sensitivity | Gold standard; slow |
| Mantoux (tuberculin) test | Delayed hypersensitivity | Cannot separate infection from disease |
| IGRA | IFN-γ release to TB antigens | Not affected by BCG |

::: mistake
A positive Mantoux test does ==not prove active disease==. BCG vaccination and past infection also cause it.
:::

## Treatment

Standard drug-sensitive TB is treated with four drugs for two months, then two or three drugs for four months. In India this is delivered under [[NTEP]].

::: treatment Standard regimen
**Intensive phase (2 months):** isoniazid (H), rifampicin (R), pyrazinamide (Z), ethambutol (E)

**Continuation phase (4 months):** H, R, E
:::

| Drug | Key adverse effect | Prevention or note |
|---|---|---|
| Isoniazid | Peripheral neuropathy, hepatitis | Give pyridoxine |
| Rifampicin | Orange-red body fluids, hepatitis, enzyme induction | Interacts with many drugs |
| Pyrazinamide | Hyperuricaemia, hepatitis | |
| Ethambutol | Optic neuritis (red–green colour blindness) | Check vision |

## Previous questions

::: pyq SAQ · sample
Describe the Ghon complex.
:::

::: pyq LAQ · sample
Describe the pathogenesis, laboratory diagnosis and treatment of pulmonary tuberculosis.
:::
`);
