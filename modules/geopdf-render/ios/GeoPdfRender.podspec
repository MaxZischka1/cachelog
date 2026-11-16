Pod::Spec.new do |s|
  s.name           = 'GeoPdfRender'
  s.version        = '0.1.0'
  s.summary        = 'Renders a PDF page to PNG with PDFKit for Cachelog GeoPDF map layers'
  s.description    = s.summary
  s.license        = 'MIT'
  s.author         = 'Cachelog'
  s.homepage       = 'https://github.com/expo/expo'
  s.platforms      = {
    :ios => '16.4'
  }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'PDFKit', 'UIKit'

  s.source_files = "**/*.{h,m,swift}"
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
