---
name: prepare-art-jpg
description: Use this skill when the user asks to process artwork or painting photos from a Google Drive folder: download images through the connected Drive access, crop each artwork tightly, build a dense square/rectangular collage with equal white gaps, and produce numbered JPG files with badges.
---

# Prepare Art JPG

## When To Use

Use this skill when the user asks to prepare artwork photos, painting photos, drawings, participant works, final JPGs, a collage, or numbered images from a Google Drive folder.

Typical requests:

- "Подготовь фото картин из папки Google Drive"
- "Обрежь работы, сделай коллаж и пронумеруй картинки"
- "Сделай коллаж из картин без пустых мест"
- "Скачай работы, обрежь по краю краски и сделай финальные JPG"

The user does not need to remember the skill name. Trigger it by task meaning.

## Core Rules

- When a Google Drive folder link is provided, use the Google Drive connector first for listing files.
- Use the user's connected Drive access for the requested folder/files. Do not ask whether to use it again.
- Process only image files unless the user says otherwise.
- Preserve a natural, useful order: numbers in filenames like `(1)`, `(2)`, etc. first; otherwise natural filename sorting.
- Do not add numbers to the collage unless the user explicitly asks.
- Do create numbered individual JPGs as a final output stage unless the user explicitly asks not to.

## Workflow

### 1. List And Download

1. List the Drive folder immediately with the Drive connector.
2. Record each image title, file ID, MIME type, and intended sequence number.
3. Download originals using the connected Drive access when available.
4. If direct Drive raw download is unavailable but the folder is link-accessible, use file IDs from the Drive connector and a public direct-download URL as a fallback.
5. Keep originals separate from processed outputs.

### 2. Crop Artworks First

Crop every image before making any collage or numbered output.

- Apply EXIF orientation first.
- Crop to the artwork, drawing, sheet, or painted area as tightly as possible.
- Remove outdoor background, table/easel edges, notebook/page edges, paper borders, white mats, and empty margins that are not part of the artwork.
- If the photo includes a page with a painted rectangle, crop to the edge of the paint, not to the outside paper border.
- If the artwork is angled, correct perspective using the artwork/page contour before final crop.
- For photos where automatic crop leaves a frame or surrounding context, manually tighten the crop.
- Preserve orientation unless layout requires placing one vertical image where two horizontal slots would otherwise fit.
- Do not distort the artwork during the crop stage.
- Apply only light enhancement: gentle autocontrast, color, contrast, and sharpening.

### 3. Build The Collage

Create a collage from the cropped artworks.

- The collage must be a clean rectangle or square, with no empty cells or obvious holes.
- Use a white background and equal white gaps horizontally and vertically.
- Keep the outer margin visually consistent with the inner gaps.
- Prefer a dense mosaic over a loose grid when artwork aspect ratios differ.
- It is allowed to slightly resize and crop individual artworks inside their collage slots so the whole collage becomes a solid rectangle.
- It is allowed to use one vertical artwork in the space of two stacked horizontal slots, or two horizontal artworks in the space of one vertical slot, when that makes the layout tighter.
- Avoid large blank areas caused by fitting everything into square cells.
- Do not number the collage by default.
- Save a full-size collage JPG.
- Also create an email version when useful or requested: resize the final collage to 1200 px wide, preserve aspect ratio, save as optimized/progressive JPEG.

### 4. Create Numbered JPGs

Create a numbered set from the cropped artworks after the collage is made.

- Final numbered files must be sequential: `1.jpg`, `2.jpg`, ..., using the determined order.
- Resize each numbered image so the long side is about 2000 px unless the user requests another size.
- Add a number badge in the top-left corner.
- Badge style: white circle, thin dark outline, Montserrat Bold digits, optically centered.
- Preserve the cropped artwork's natural orientation and proportions.
- Do not pad, stretch, or force square canvases for the numbered individual files.

### 5. Output Folders

Create a clear output folder, for example:

- `cropped_artworks` for cropped intermediate JPGs if useful for review.
- `collage` or a clearly named collage file for the final collage.
- `ready_jpg` for numbered final JPGs.

Do not mix temporary downloads, scripts, logs, and final deliverables in the final numbered folder.

### 6. Verify

Before responding:

- Confirm each final image opens as JPEG.
- Confirm the collage is rectangular/square with no missing cells.
- Confirm gaps between collage items are equal and white.
- Confirm obvious borders/frames/backgrounds have been cropped away.
- Confirm numbered JPGs are sequential and include number badges.
- If an email version was requested, confirm it is exactly 1200 px wide.

## Final Response

Respond in Russian unless the user used another language.

Keep the final response short:

- Give the local path/link to the collage.
- Give the local path/link to the email-size collage if created.
- Give the local path/link to the numbered JPG folder.
- Mention only important caveats if something could not be completed.
