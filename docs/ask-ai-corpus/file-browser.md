---
visibility: PUBLIC
---
# File Browser (Forms Library & Logos)

Dashboard section: (none — reached via the "Tools" menu's "MSFG Docs" button, or the "Marketing" menu's "Logos" button)

## What it is
The File Browser is a read-only, folder-by-folder viewer over two S3 buckets: the **Forms Library** (`msfg-mortgage-documents-prod`) and **Logos / Media** (`msfg-media`, rooted at its `Assets/` prefix, so folders like HEADSHOTS, LOGOS, PICTURES, partners, and sigs are all browsable). It opens as its own popup window, not inside the main dashboard layout.

## How to find it
- Tools menu → "MSFG Docs" opens the Forms Library.
- Marketing menu → "Logos" opens the Logos/Media library.

Each opens the same File Browser popup, just pointed at a different library via a `?library=` parameter.

## Common tasks

### Browse folders
Click a folder row to navigate into it; the breadcrumb bar at the top tracks your path and lets you jump back to any parent folder (or the library root) by clicking it.

### Download a file
Click anywhere on a file's row, or its download icon, to fetch a temporary (15-minute) download link and open it in a new tab. Files show their size and last-modified date.

### Find a specific brand asset
In the Logos/Media library, navigate into the relevant `Assets/` subfolder (e.g. HEADSHOTS for employee photos, LOGOS for brand marks, PICTURES, partners, or sigs) — the browser lists whatever folders exist at each level rather than assuming a fixed structure.

## FAQ
**Q: Can I upload a file from this browser?**
A: No — the File Browser is view/download only. Adding new files to the Forms Library is an admin-only action done from Admin Settings, not from this popup.

**Q: Why does the page title change between "Forms Library" and "Media & Brand Assets"?**
A: The title reflects whichever library you opened it with — MSFG Docs opens the Forms Library, Logos opens Media & Brand Assets. They're the same browser UI pointed at different S3 buckets.

**Q: I navigated into a folder — how do I get back to the top?**
A: Click the library name (the first item) in the breadcrumb bar to jump back to the root, or click any breadcrumb segment to return to that level.
