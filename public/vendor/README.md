# Vendored scripts

`tesseract.min.js` is `tesseract.js@7.0.0` (`dist/tesseract.min.js`, Apache-2.0), served from this
folder instead of a CDN so the page never executes third-party code fetched at load time.
It is only used as the fallback reader when the server has no OCR engine installed. Its worker,
WebAssembly core and English language data are still downloaded by the library on first use.
