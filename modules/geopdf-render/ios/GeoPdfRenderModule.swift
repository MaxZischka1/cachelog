import ExpoModulesCore
import PDFKit
import UIKit

/// Renders one PDF page to a PNG so a GeoPDF can be drawn as a raster map layer.
///
/// The image covers `region` ([x1, y1, x2, y2] in PDF user space, e.g. the map frame) or, when it
/// is null, the page's crop box, as displayed (the page's /Rotate applied). The JS GeoPDF reader
/// returns corners for the same rectangle (top-left, top-right, bottom-right, bottom-left), so the
/// PNG and those corners line up.
public class GeoPdfRenderModule: Module {
  public func definition() -> ModuleDefinition {
    Name("GeoPdfRender")

    /// Returns the output size in pixels. The longest side is `maxSide`.
    AsyncFunction("renderPage") { (sourceUri: String, pageIndex: Int, maxSide: Int, outputUri: String, region: [Double]?) throws -> [String: Int] in
      try renderPdfPage(sourceUri: sourceUri, pageIndex: pageIndex, maxSide: maxSide, outputUri: outputUri, region: region)
    }

    /// The page's words with their boxes in PDF user space: [{ t, x, y, w, h }], x/y = bottom-left.
    /// Used to read form fields (opening number, prescription) printed on the map sheet.
    AsyncFunction("pageWords") { (sourceUri: String, pageIndex: Int) throws -> [[String: Any]] in
      let document = try openPdf(sourceUri)
      guard pageIndex >= 0, pageIndex < document.pageCount, let page = document.page(at: pageIndex) else {
        throw PdfPageException(pageIndex + 1)
      }
      return pdfPageWords(page).map { ["t": $0.text, "x": $0.box.minX, "y": $0.box.minY, "w": $0.box.width, "h": $0.box.height] }
    }
  }
}

private func openPdf(_ uri: String) throws -> PDFDocument {
  guard let document = PDFDocument(url: try localFileURL(uri)) else { throw PdfOpenException() }
  if document.isLocked { throw PdfLockedException() }
  return document
}

struct PdfWord {
  var text: String
  var box: CGRect
}

/// Splits the page text into words: at whitespace, and where the next character is not next to
/// the previous one on the same line (separate text runs often have no space between them).
/// Each character's text and box come from the same PDFSelection; `page.string` indexes do not
/// line up with `characterBounds(at:)` on real map sheets.
func pdfPageWords(_ page: PDFPage) -> [PdfWord] {
  guard let all = page.selection(for: page.bounds(for: .mediaBox)) else { return [] }
  var words: [PdfWord] = []
  for line in all.selectionsByLine() {
    let count = line.numberOfTextRanges(on: page)
    var current: PdfWord?
    var last: (text: String, box: CGRect)?
    func flush() {
      if let w = current, !w.text.isEmpty { words.append(w) }
      current = nil
    }
    for r in 0..<count {
      let range = line.range(at: r, on: page)
      guard range.location != NSNotFound else { continue }
      for i in range.location..<(range.location + range.length) {
        guard let sel = page.selection(for: NSRange(location: i, length: 1)),
              let ch = sel.string, !ch.isEmpty else { continue }
        if ch.allSatisfy({ $0.isWhitespace }) {
          flush()
          continue
        }
        let b = sel.bounds(for: page)
        if b.isEmpty || !b.minX.isFinite {
          flush()
          continue
        }
        // PDFKit repeats the last character of a text run at the run's end: same glyph, same box.
        if let l = last, l.text == ch, overlapRatio(b, l.box) > 0.5 { continue }
        last = (ch, b)
        if var w = current {
          let h = max(w.box.height, b.height, 1)
          let gap = b.minX - w.box.maxX
          let sameLine = abs(b.midY - w.box.midY) < h * 0.5
          if sameLine && gap > -h * 0.3 && gap < h * 0.35 {
            w.text += ch
            w.box = w.box.union(b)
            current = w
            continue
          }
          flush()
        }
        current = PdfWord(text: ch, box: b)
      }
    }
    flush()
  }
  return words
}

/// Share of `a`'s area that lies inside `b`.
func overlapRatio(_ a: CGRect, _ b: CGRect) -> CGFloat {
  let i = a.intersection(b)
  guard !i.isNull, a.width > 0, a.height > 0 else { return 0 }
  return (i.width * i.height) / (a.width * a.height)
}

private func localFileURL(_ uri: String) throws -> URL {
  if uri.hasPrefix("file://"), let url = URL(string: uri) { return url }
  if uri.hasPrefix("/") { return URL(fileURLWithPath: uri) }
  throw NotLocalFileException(uri)
}

/// Maps PDF user space to the displayed rectangle (origin bottom-left, y up) for `rect` shown
/// with the page's clockwise /Rotate.
func displayTransform(rect r: CGRect, rotation: Int) -> CGAffineTransform {
  switch rotation {
  case 90: return CGAffineTransform(a: 0, b: -1, c: 1, d: 0, tx: -r.minY, ty: r.maxX)
  case 180: return CGAffineTransform(a: -1, b: 0, c: 0, d: -1, tx: r.maxX, ty: r.maxY)
  case 270: return CGAffineTransform(a: 0, b: 1, c: -1, d: 0, tx: r.maxY, ty: -r.minX)
  default: return CGAffineTransform(translationX: -r.minX, y: -r.minY)
  }
}

private func renderPdfPage(sourceUri: String, pageIndex: Int, maxSide: Int, outputUri: String, region: [Double]?) throws -> [String: Int] {
  let output = try localFileURL(outputUri)

  let document = try openPdf(sourceUri)
  guard pageIndex >= 0, pageIndex < document.pageCount,
        let page = document.page(at: pageIndex), let cgPage = page.pageRef else {
    throw PdfPageException(pageIndex + 1)
  }

  let cropBox = cgPage.getBoxRect(.cropBox)
  var box = cropBox
  if let region = region {
    guard region.count == 4, region.allSatisfy({ $0.isFinite }) else { throw PdfRegionException() }
    box = CGRect(x: min(region[0], region[2]), y: min(region[1], region[3]), width: abs(region[2] - region[0]), height: abs(region[3] - region[1]))
  }
  // Size as displayed: width and height swap for 90° and 270° rotations.
  let rotation = ((Int(cgPage.rotationAngle) % 360) + 360) % 360
  let shownW = rotation % 180 == 0 ? box.width : box.height
  let shownH = rotation % 180 == 0 ? box.height : box.width
  guard shownW > 0, shownH > 0 else { throw PdfPageException(pageIndex + 1) }

  // PDF maps are vector, so scale the page to the size the map layer can use (up or down).
  let scale = CGFloat(max(1, maxSide)) / max(shownW, shownH)
  let width = max(1, Int((shownW * scale).rounded()))
  let height = max(1, Int((shownH * scale).rounded()))

  let format = UIGraphicsImageRendererFormat.default()
  format.scale = 1
  format.opaque = true
  let renderer = UIGraphicsImageRenderer(size: CGSize(width: width, height: height), format: format)
  let png = renderer.pngData { context in
    let cg = context.cgContext
    cg.setFillColor(UIColor.white.cgColor)
    cg.fill(CGRect(x: 0, y: 0, width: width, height: height))
    // UIKit's origin is top-left; PDF's is bottom-left. Flip, then stretch the shown page to the
    // exact pixel size so its four corners land on the image corners.
    cg.translateBy(x: 0, y: CGFloat(height))
    cg.scaleBy(x: CGFloat(width) / shownW, y: -CGFloat(height) / shownH)
    cg.concatenate(displayTransform(rect: box, rotation: rotation))
    // Content outside the crop box is never shown, even when the region extends past it.
    cg.clip(to: box.intersection(cropBox))
    cg.interpolationQuality = .high
    cg.drawPDFPage(cgPage)
  }

  do {
    try FileManager.default.createDirectory(at: output.deletingLastPathComponent(), withIntermediateDirectories: true)
    try png.write(to: output, options: .atomic)
  } catch {
    throw PdfWriteException(error.localizedDescription)
  }
  return ["width": width, "height": height]
}

internal final class NotLocalFileException: GenericException<String>, @unchecked Sendable {
  override var reason: String {
    "Not a local file: \(param)"
  }
}

internal final class PdfOpenException: Exception, @unchecked Sendable {
  override var reason: String {
    "Could not open the PDF. The file may be damaged or not a PDF."
  }
}

internal final class PdfLockedException: Exception, @unchecked Sendable {
  override var reason: String {
    "This PDF is password protected. Save a copy without the password and import that."
  }
}

internal final class PdfPageException: GenericException<Int>, @unchecked Sendable {
  override var reason: String {
    "Could not read page \(param) of the PDF."
  }
}

internal final class PdfRegionException: Exception, @unchecked Sendable {
  override var reason: String {
    "The map area to draw is not a valid rectangle."
  }
}

internal final class PdfWriteException: GenericException<String>, @unchecked Sendable {
  override var reason: String {
    "Could not save the map image: \(param)"
  }
}
