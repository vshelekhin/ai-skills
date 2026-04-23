---
name: RPS_проверка_презентаций
description: Проверка англоязычных презентаций RPS (RedPointSchool) в Google Slides по внутреннему чек-листу. Используй, когда нужно проверить текущий день марафона или воркшопа, сравнить формулировки с предыдущими днями, отдельно сверить текст на слайдах и заметки докладчика и выдать результат в формате `Соблюдено ✅` и `Нарушения ❌`.
---

# RPS_проверка_презентаций

Use this skill to audit English-language RPS workshop presentations.

## Core workflow

1. Export the deck as `.pptx` and `.txt`.
2. Use `.pptx` to determine the real slide numbering.
3. Use `.txt` to read speaker notes.
4. Check only the rules that apply to the current day.
5. Compare with previous days when the rule is about rewrites or repetition.
6. Answer in two sections only:
   - `Соблюдено ✅`
   - `Нарушения ❌`

## Report rules

- Always put `Соблюдено ✅` first.
- Write `Слайд N`.
- Write `заметки`, not `notes`.
- If one slide has multiple issues, combine them into one line.
- Keep the wording short and concrete.

## Source of truth

- Trust `.pptx` for slide numbering.
- Trust `.txt` for speaker notes.
- Do not trust XML text order for visual slide layout.
- If slide text may be split across separate objects and XML order is misleading, do not flag it unless the issue is visibly confirmed.

## RPS English-specific rules

- These decks belong to RPS (RedPointSchool).
- For the audience-size line, the expected English wording is based on `3,000`, not the Russian checklist wording about `5 thousand`.
- If day 1 says `Over 3,000 people are participating in our workshop!`, later days should keep `3,000`.

## What to check

### Opening

- Day 1: workshop is starting.
- Days 2-4: workshop is continuing.
- Day 5: workshop is wrapping up.
- There is a sound-check request with `+` in the chat.

### Bonus lessons at the beginning

- Three bonus lessons are present.
- Duration is shown on each bonus slide.
- Watch for contradictions in the notes, especially day/broadcast counts.

### Expert slide

- The main host may be described in detail.
- The short-description rule applies to other invited artists, not the host.
- The note under the expert slide should change across days.

### Yesterday block

- From day 2 onward, there should be a `What did we do yesterday?` block.
- In the notes there should be a line that the recording is already in the personal account.

### Impressions

- From day 2 onward, participant impressions should be present.

### Artwork analysis

- If the user says reviews are not ready yet, do not count their absence as a violation.
- If reviews are present, prefer this structure:
  - author
  - support-the-author prompt
  - what worked
  - what to improve
  - connection to the course

### First course entry

- Compare this wording with previous days.
- It should change from day to day.
- It should match the current day and current painting.

### Course and bonus descriptions

- Course lesson descriptions should be rewritten across days.
- Bonus descriptions should also be rewritten across days.

### TOTAL block follow-up

- In English RPS decks, do not judge the question under `TOTAL`.
- Instead, compare the first sentence in the notes under the next slide after `TOTAL`.
- That sentence must differ across days.

### Remaining spots

- From day 2 onward, the number on the slide and in the notes must match.
- Keep the RPS English audience-size wording aligned with day 1 (`3,000` if day 1 uses `3,000`).

### Upload-your-artwork block

- From day 2 onward, it should say `Let me remind you how to upload your painting`.
- It should not say `Let me tell you how to upload your painting`.
- The block should keep the meaning that only this way the work is seen and counted as submitted.
- From day 2 onward, these lines should not appear:
  - `No need to send them to support.`
  - `Is everyone clear on how to upload your drawing? Type "Plus" in the chat!`

### Secret letters

- Check that the revealed letter matches the current day.
- Day 1: under the last bonus slide.
- Day 2: under the `TOTAL` block.
- Day 3: under discounted pricing.
- Day 4: under the `TOTAL` block.
- Day 5: in the final bonus-claim block.

### Day 5 bonus-access block

- In the large note under the last bonus slide, bonus access must be described as 3 days, not 7 days.
- Accept examples like:
  - `You’ll have access to the bonuses for 3 days after the workshop ends`
  - `Bonuses are available for 3 days total. If you claim them on day 2, you'll have 2 days left to watch.`
- Flag examples like:
  - `BONUSES ARE VALID FOR 7 DAYS from the moment you enter the letters`

### English slide-text checks

- Flag clear meaning errors on slides.
- Flag wrong currency formatting on slides only if it is clearly visible on the slide.
- Do not flag slide-format issues based only on XML ordering.

## Typical valid finding style

- `Слайд 50, заметки: должно быть remind, а не tell, и не должно быть фраз ...`
- `Слайд 51, заметки: неверно указан срок доступа к бонусам — стоит ... , а должен быть вариант с доступом на 3 дня.`

## Do not auto-flag

- awkward but non-critical English in `заметки`
- XML-only text-order artifacts
- missing reviews when the user has said they are not ready yet
