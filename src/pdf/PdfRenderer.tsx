/**
 * On-device PDF page rendering, the way Avenza does it: draw the map once at import time and keep
 * the image. Uses PDF.js in an invisible WebView, so it works in Expo Go and in full builds alike.
 *
 * Mount <PdfRendererHost /> once near the root; call renderPdfPage() from anywhere.
 */
import React, { useEffect, useMemo, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import WebViewBase, { type WebViewMessageEvent } from 'react-native-webview';
import { PDFJS_SCRIPT, PDFJS_WORKER_SCRIPT } from './pdfjsSource.generated';
import { RENDER_HTML } from './renderHtml';

export interface RenderJob {
  /** Whole PDF file, base64. */
  b64: string;
  page?: number;
  /** Region to draw in page user space: x1, y1, x2, y2. Defaults to the whole page. */
  crop?: [number, number, number, number];
  /** Pixel budget for the output image. */
  maxPixels?: number;
  quality?: number;
}

export interface RenderResult {
  /** JPEG, base64 without the data: prefix. */
  jpegB64: string;
  width: number;
  height: number;
  /** Text strings on the page, in drawing order. */
  text: string[];
}

/** react-native-webview's default generic (undefined) collapses its props to never under TS 6. */
type NoExtraProps = Record<never, never>;
const WebView = WebViewBase as unknown as typeof WebViewBase<NoExtraProps>;
type WebView = WebViewBase<NoExtraProps>;

type Pending = { resolve: (r: RenderResult) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> };

/** 8 MP: sharp at block scale, well inside iOS canvas and memory limits. */
const DEFAULT_PIXELS = 8_000_000;
const JOB_TIMEOUT_MS = 90_000;
const READY_TIMEOUT_MS = 20_000;

let host: { inject: (js: string) => void } | null = null;
let ready = false;
const readyWaiters: (() => void)[] = [];
const pending = new Map<string, Pending>();
let seq = 0;

function waitReady(): Promise<void> {
  if (ready && host) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('The PDF renderer did not start. Close and reopen the app, then try again.')), READY_TIMEOUT_MS);
    readyWaiters.push(() => {
      clearTimeout(t);
      resolve();
    });
  });
}

export async function renderPdfPage(job: RenderJob): Promise<RenderResult> {
  await waitReady();
  const id = `r${++seq}`;
  return new Promise<RenderResult>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error('Drawing the PDF took too long. Try a smaller map file.'));
    }, JOB_TIMEOUT_MS);
    pending.set(id, { resolve, reject, timer });
    const payload = { id, b64: job.b64, page: job.page ?? 0, crop: job.crop ?? null, maxPixels: job.maxPixels ?? DEFAULT_PIXELS, quality: job.quality ?? 0.85 };
    host!.inject(`window.__render(${JSON.stringify(payload)});true;`);
  });
}

function onMessage(e: WebViewMessageEvent) {
  let msg: any;
  try {
    msg = JSON.parse(e.nativeEvent.data);
  } catch {
    return;
  }
  if (msg.type === 'ready') {
    ready = true;
    readyWaiters.splice(0).forEach((f) => f());
    return;
  }
  if (msg.type === 'result') {
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    clearTimeout(p.timer);
    if (!msg.ok) return p.reject(new Error(`Could not draw the PDF: ${msg.error}`));
    const data: string = msg.data ?? '';
    p.resolve({ jpegB64: data.slice(data.indexOf(',') + 1), width: msg.width, height: msg.height, text: msg.text ?? [] });
  }
}

/** Invisible WebView that hosts PDF.js. Mount once at the app root. */
export function PdfRendererHost() {
  const ref = useRef<WebView>(null);
  const injected = useMemo(() => `${PDFJS_WORKER_SCRIPT}\n${PDFJS_SCRIPT}\ntrue;`, []);
  useEffect(() => {
    host = { inject: (js) => ref.current?.injectJavaScript(js) };
    return () => {
      host = null;
      ready = false;
    };
  }, []);
  return (
    <View style={styles.hidden} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <WebView
        ref={ref}
        originWhitelist={['*']}
        source={{ html: RENDER_HTML }}
        injectedJavaScriptBeforeContentLoaded={injected}
        onMessage={onMessage}
        onContentProcessDidTerminate={() => {
          ready = false;
          ref.current?.reload();
        }}
        javaScriptEnabled
        style={styles.web}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  hidden: { position: 'absolute', width: 2, height: 2, left: -10, top: -10, opacity: 0 },
  web: { width: 2, height: 2 },
});
