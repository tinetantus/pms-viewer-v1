# Processor

Pinned PDFium, pypdf, Pillow, NumPy and OpenCV processor. Reads a JSON request file and writes result JSON plus PNG evidence into the supplied temporary output directory. Native annotation objects are excluded; flattened marks remain artwork. Page maps, coverage limits and uncertain extraction are retained as evidence. Run tests/processor_test.py for synthetic validation. A subprocess is not a complete security sandbox; see docs/operations.md.
