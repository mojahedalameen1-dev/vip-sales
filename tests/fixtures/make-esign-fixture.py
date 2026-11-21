"""Create the synthetic Arabic signing fixture with PyMuPDF 1.26.7."""

from html import escape
from pathlib import Path

import pymupdf as pdf


here = Path(__file__).resolve().parent
fonts = pdf.Archive(str(here.parents[1] / "assets" / "fonts"))
css = """
@font-face {font-family: Arabic; src: url(ibm-plex-arabic-400.ttf)}
body {margin: 0}
p {font-family: Arabic; font-size: 15pt; margin: 0}
"""
doc = pdf.open()
label_cache = {}


def arabic(x, y, text):
    if text not in label_cache:
        labels = pdf.open()
        label = labels.new_page(width=300, height=70)
        label.insert_htmlbox(label.rect, f'<p dir="rtl">{escape(text)}</p>', css=css, archive=fonts, scale_low=1)
        spans = [span for block in label.get_text("dict")["blocks"]
                 for line in block["lines"] for span in line["spans"]]
        rect = pdf.Rect(spans[0]["bbox"])
        for span in spans[1:]:
            rect |= pdf.Rect(span["bbox"])
        label_cache[text] = labels, rect, spans[0]["origin"][1]
    labels, rect, baseline = label_cache[text]
    top = 800 - y - (baseline - rect.y0)
    page.show_pdf_page(pdf.Rect(x, top, x + rect.width, top + rect.height), labels, 0, clip=rect)


def line(y, offset=0, graphic=False):
    baseline = 800 - y
    if graphic:
        page.draw_line((302 + offset, baseline), (466 + offset, baseline), width=0.9, dashes="[2 2] 0")
    else:
        page.insert_text((321 + offset, baseline), "." * 35, fontsize=15)
    arabic(474 + offset, y, "التوقيع")


def parties(y):
    arabic(421, y + 73, "الطرف الأول")
    arabic(444, y + 37, "اسم المدير")
    arabic(144, y + 73, "الطرف الثاني")
    line(y, -270)
    arabic(22, y - 48, "التاريخ")
    page.insert_text((105, 800 - (y - 48)), "." * 12, fontsize=15)


for baseline in (625, 400, 137):
    page = doc.new_page(width=600, height=800)
    parties(baseline)
    line(baseline)

page = doc.new_page(width=600, height=800)
parties(400)
line(400, graphic=True)

page = doc.new_page(width=600, height=800)
parties(425)
line(425)
arabic(421, 493, "الطرف الثاني")

page = doc.new_page(width=600, height=800)
parties(540)
line(540)
arabic(432, 371, "شركة أوامر الشبكة لتقنية المعلومات")
line(300)

page = doc.new_page(width=600, height=800)
parties(400)
line(400)
arabic(369, 397, "بيانات أساسية")
doc.set_metadata({"title": "Synthetic Arabic signature locations"})
doc.subset_fonts()
doc.save(here / "esign-arabic.pdf", garbage=4, deflate=True, no_new_id=True)
