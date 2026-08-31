repo: Geoinfotech-Web/Election-Dashboard
branch: main
path: Election Dashboard/public

## Last sync
date: 2026-08-14T09:56:00Z
commit: 3d50e6c3e13b (tree hash — commit sha unknown)

### Updated in this project
- Read the original style system to ground the global redesign
- Replaced green-as-brand + Arial/Calibri with neutral chrome, teal primary, IBM Plex type
- Replaced the sci-fi animated-globe hero with a GIS-grade basemap surface
- Generalised Nigeria-only hierarchy (State/LGA/Ward/PU) to flexible global terminology

## Screen map
| Screen | Built from |
| --- | --- |
| Global Overview.dc.html | public/index.html, public/styles.css, public/election-results.html, public/theme.js |

## Original style notes (for reference)
- Fonts: Arial / Helvetica / Calibri
- Primary (brand-wide): green #159763 / #19a86b / #2cc878 / #5fe09b
- Accents: gold #dca73a/#f0c95b, blue #1967b3/#1e6de5, violet #7440b7
- Surfaces: dark teal-navy #071116 / #0b1b24 / #10212b
- Maps: Leaflet + shp.js; basemap switcher (hillshade/streets/satellite), choropleth legend, layer toggles
- Nigeria-specific: States+FCT (36), 774 LGAs, 8809+ Wards, 176k+ Polling Units, INEC party colors
