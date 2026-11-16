import { requireOptionalNativeModule } from 'expo';

export interface GeoPdfRenderModule {
  /**
   * Render page `pageIndex` (0-based) of the PDF at `sourceUri` to a PNG at `outputUri`, with the
   * longest side `maxSide` pixels. Covers `region` ([x1, y1, x2, y2] in PDF user space) or, when
   * null, the crop box, as displayed (page rotation applied).
   */
  renderPage(
    sourceUri: string,
    pageIndex: number,
    maxSide: number,
    outputUri: string,
    region: [number, number, number, number] | null,
  ): Promise<{ width: number; height: number }>;
}

/**
 * The native PDF renderer, or null where it is not built in: Android, web, Jest, and iPhone
 * builds made before this module was added.
 */
export const GeoPdfRender = requireOptionalNativeModule<GeoPdfRenderModule>('GeoPdfRender');
