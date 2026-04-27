---
name: prepare-art-jpg
description: Use this skill when the user asks to download artwork or painting photos from a Google Drive folder and prepare a final numbered JPG set. It covers listing Drive files, downloading original JPGs by file ID, tightly cropping artwork, correcting perspective, resizing, lightly enhancing, adding Montserrat Bold number badges, and returning only the ready folder.
---

# Prepare Art JPG

## When To Use

Use this skill for requests like:

- "Обработай фотографии картин из папки Google Drive и подготовь JPG"
- "Скачай изображения из папки, обрежь картины и пронумеруй"
- "Сделай комплект 1.jpg ... 10.jpg с кружками-номерами"

Best invocation: the user calls `$prepare-art-jpg` and includes the Google Drive folder URL in the same message.

If the user invokes the skill without a folder link, ask one short question for the Google Drive folder URL. Do not ask for confirmation image by image unless the user explicitly requests manual review.

## Workflow

1. Get the Google Drive folder file list immediately.
   - Use the Drive folder listing tool when available.
   - Record each file's title, file ID, and MIME type.
   - Process only image files unless the user says otherwise.

2. Determine output order.
   - If source filenames contain numbers like `(1)`, `(2)`, ..., use those numbers for ordering.
   - Otherwise use natural filename sorting.
   - Final files must be named sequentially: `1.jpg`, `2.jpg`, ..., up to the image count requested or found.

3. Download originals.
   - Download JPGs directly by file ID using this URL shape:
     `https://drive.google.com/uc?export=download&id=FILE_ID`
   - Do not use Google Drive preview/view URLs for downloading when a file ID is available.
   - If a system TLS issue blocks a download command, use another direct-download method that still uses the same `uc?export=download&id=FILE_ID` URL.

4. Prepare typography.
   - Use Montserrat Bold for the number badge.
   - If Montserrat Bold already exists locally, use it.
   - If it does not exist, download it locally from Google Fonts.
   - Do not mention this technical step to the user unless there is a blocker.

5. Process each image.
   - Apply EXIF orientation first.
   - Crop as tightly as possible to the artwork/drawing edge.
   - Remove paper borders and white margins that are not part of the artwork.
   - If the photo is angled, correct perspective using the artwork contour.
   - Preserve natural orientation: horizontal stays horizontal; vertical stays vertical.
   - Do not make square canvases, add backgrounds, pad, stretch, or distort.
   - Resize so the long side is about 2000 px; calculate the short side from the original proportions.
   - Apply light quality enhancement only: gentle autocontrast, color, and sharpening.

6. Add the number badge.
   - Place it in the top-left corner.
   - Use a white circle with a thin dark outline.
   - Center the number optically and geometrically inside the circle.
   - Use Montserrat Bold for the digits.

7. Create the final folder.
   - Create a new folder named `ready_jpg` unless that exact name already exists; then use a clear dated or suffixed variant.
   - The final folder must contain only the final JPGs: `1.jpg`, `2.jpg`, ..., no preview, zip, source images, scripts, logs, or temporary files.

8. Verify before final response.
   - Confirm the final folder contains exactly the expected JPG files.
   - Confirm every output file opens as JPEG.
   - Confirm each image has about 2000 px on the long side.

## Final Response

Respond in Russian unless the user used another language.

Keep the final answer very short:

- Give only the local folder link/path to the ready JPG folder.
- Briefly say the комплект is ready.

Do not include technical process details, command summaries, previews, or archives unless the user asks.
