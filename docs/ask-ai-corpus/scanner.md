# Document Scanner

Dashboard section: (none — reached via the "Systems" menu's "Document Scanner" link; opens scanner.html as its own full page, not a dashboard section)

## What it is
The Document Scanner cleans up hard-to-read scans and phone photos of documents (bank statements, paystubs, etc.) — auto-enhancing contrast and sharpness, letting you crop/rotate/de-skew, and exporting a cleaned PDF or image. It accepts JPG, JPEG, PNG, PDF, HEIC, and SVG files up to 50 MB, one or several at a time.

## How to find it
Open the "Systems" menu in the top nav and click "Document Scanner." This navigates away from the dashboard to its own page (scanner.html), with a "Back to Dashboard" link in its header to return.

## Common tasks

### Clean up a single scan or photo
Drop a file onto the dropzone (or click it to browse), then pick a Preset — Original (no enhancement), Statement Restore (AI Enhanced, the default), Document (Color), Document B&W (Auto), or Photo — and click "Apply" to reprocess. Fine-tune with the Brightness, Contrast, Saturation, and Sharpness sliders (Reset reverts them), and use the image tools above the Before/After preview: rotate left/right, 2× Upscale, Denoise, Flatten Light, Auto Levels, Corner Fix (for perspective/keystone correction), Crop, and Undo/Redo.

### Process a multi-page document
Drop multiple files (or a multi-page PDF) to get a page strip with Prev/Next navigation and an "Apply All" button to run the current preset across every page. Choose an Export profile (Standard PDF, Statement upload profile, or Compact under a target file size in MB), optionally paste OCR/search text so the exported PDF is text-searchable, and set a file name before exporting.

### Export or share the result
Use the action bar at the bottom: Download (saves the cleaned file), PDF (combines pages into a PDF), Copy (copies the image to your clipboard), or Print. "Save to Loan Folder" only works when the scanner is embedded inside another dashboard page that's set up to receive it — opening the scanner from the Systems menu link (a standalone page) doesn't wire that up, so that button stays disabled in normal use.

## FAQ
**Q: Why is "Save to Loan Folder" grayed out?**
A: That button only activates when the scanner is loaded inside the dashboard as an embedded frame with a save target configured. Reaching it via the Systems menu opens it as a standalone page, so use Download/PDF and save the file manually instead.

**Q: What's the difference between the presets?**
A: "Statement Restore (AI Enhanced)" is tuned for bank/financial statements and is the default; "Document (Color)" and "Document B&W (Auto)" suit general paperwork; "Photo" is for non-document images; "Original" applies no enhancement at all.

**Q: Can I fix a crooked or keystoned photo of a document?**
A: Yes — use "Corner Fix" to drag the four corner handles onto the document's edges and apply a perspective correction, or "Crop" for a simple rectangular crop.
