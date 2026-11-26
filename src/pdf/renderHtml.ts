/**
 * The page inside the hidden WebView. PDF.js (injected before load as plain scripts) draws one page
 * region to a canvas and posts back a JPEG data URL plus the page text. Runs fully offline.
 *
 * Messages to RN: {type:'ready'} | {type:'result', id, ok, data?, width?, height?, text?, error?}
 * Jobs from RN: window.__render({id, b64, page, crop, maxPixels, quality})
 */
export const RENDER_HTML = `<!doctype html><html><head><meta charset="utf-8"></head><body>
<script>
(function () {
  function post(m) { window.ReactNativeWebView.postMessage(JSON.stringify(m)); }
  function fromB64(b64) {
    var bin = atob(b64), out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  var queue = Promise.resolve();
  window.__render = function (job) {
    queue = queue.then(function () { return run(job); });
  };
  async function run(job) {
    var doc;
    try {
      var lib = globalThis.pdfjsLib;
      if (!lib || !globalThis.pdfjsWorker) throw new Error('PDF engine did not load');
      doc = await lib.getDocument({ data: fromB64(job.b64), isEvalSupported: false, useSystemFonts: true }).promise;
      var page = await doc.getPage((job.page || 0) + 1);
      var v = page.view;
      var crop = job.crop || v;
      var wPt = crop[2] - crop[0], hPt = crop[3] - crop[1];
      var scale = Math.min(Math.sqrt(job.maxPixels / (wPt * hPt)), 8);
      var W = Math.floor(wPt * scale), H = Math.floor(hPt * scale);
      var viewport = page.getViewport({ scale: scale, rotation: 0, offsetX: -(crop[0] - v[0]) * scale, offsetY: -(v[3] - crop[3]) * scale });
      var canvas = document.createElement('canvas');
      canvas.width = W; canvas.height = H;
      var ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H);
      await page.render({ canvasContext: ctx, viewport: viewport, background: 'rgba(255,255,255,1)' }).promise;
      var data = canvas.toDataURL('image/jpeg', job.quality || 0.85);
      canvas.width = 1; canvas.height = 1;
      var text = [];
      try {
        var tc = await page.getTextContent();
        for (var i = 0; i < tc.items.length; i++) { var s = tc.items[i].str; if (s && s.trim()) text.push(s); }
      } catch (e) {}
      post({ type: 'result', id: job.id, ok: true, data: data, width: W, height: H, text: text });
    } catch (e) {
      post({ type: 'result', id: job.id, ok: false, error: String((e && e.message) || e) });
    } finally {
      if (doc) try { doc.destroy(); } catch (e) {}
    }
  }
  post({ type: 'ready' });
})();
</script></body></html>`;
