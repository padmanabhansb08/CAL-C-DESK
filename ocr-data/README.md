# October 18 OCR examples

Ten supplied screenshots cover five matches, two overlapping frames per match. `labels.json` records manually transcribed elimination counts in top-left, top-right, bottom-left, bottom-right order. These are numeric labels, not verified decorative player-name transcriptions. Sources are preserved in `images/`.

Matches 1–3 supply 240 numeral exemplars. Matches 4–5 are excluded from fitting. The original 20 exemplars remain in `reference-templates.json` so rebuilding does not accumulate duplicates. This trains the numeral template classifier, not Tesseract or RapidOCR model weights.

| Dataset | Fields | Before correct | After correct | Before wrong | After wrong | After unresolved |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Training | 240 | 185 | 238 | 4 | 0 | 2 |
| Held-out | 160 | 121 | 153 | 3 | 0 | 7 |

Held-out correct coverage increased from 75.6% to 95.6%. Unresolved fields count against coverage. `baseline.json` and `improved.json` contain field-level expected/actual values and panel geometry. Evaluation used Tesseract with no roster or optional RapidOCR comparison. It measures complete detected panels, not partial rows, placement accuracy or name accuracy. Overlapping fields count individually; only two independent matches are held out, all in the same screenshot style. This is not a general accuracy guarantee.

Match 5, placement 6, bottom-left was verified on an enlarged crop and its label corrected to 2 in both reports.

Run `node tools/train-ocr-digits.cjs` to rebuild shipped templates. Its optional argument selects the original screenshot directory. Run `node tools/ocr-dataset.cjs` to evaluate preserved images and write `evaluation.json`. Set `OCR_NODE_MODULES` to a directory containing `@napi-rs/canvas` and `tesseract.js` if the bundled runtime is elsewhere. English Tesseract data must be cached or downloadable on first use.

Low-confidence fields still require review. More independent matches and labeled player-name crops are needed to assess broader accuracy.

The subsequent original-resolution fallback recovered two additional held-out fields: 155/160 correct (96.9%), five unresolved, no incorrect accepted readings. Training fields remain 238/240 correct with two unresolved. See `original-resolution.json`. The additional pass only runs when normalized OCR and templates cannot resolve a digit; it does not replace conflicting normalized evidence. Name recognition also uses original image crops but is not scored by this numeric benchmark.
