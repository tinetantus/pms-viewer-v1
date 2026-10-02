import importlib.util
import pathlib
import tempfile
import unittest

from pypdf import PdfWriter
from pypdf.generic import DictionaryObject, NameObject, DecodedStreamObject, NumberObject, ArrayObject, FloatObject

ROOT=pathlib.Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('processor',ROOT/'services/processor/process.py')
processor=importlib.util.module_from_spec(spec)
spec.loader.exec_module(processor)


def fixture(path, text='SYNTHETIC PACKAGING PROOF', annotation=False, rotation=0):
    writer=PdfWriter()
    page=writer.add_blank_page(width=600,height=420)
    font=DictionaryObject({NameObject('/Type'):NameObject('/Font'),NameObject('/Subtype'):NameObject('/Type1'),NameObject('/BaseFont'):NameObject('/Helvetica')})
    page[NameObject('/Resources')]=DictionaryObject({NameObject('/Font'):DictionaryObject({NameObject('/F1'):writer._add_object(font)})})
    stream=DecodedStreamObject()
    stream.set_data(f'0.95 0.96 0.9 rg 0 0 600 420 re f 0.15 0.3 0.2 rg 80 65 220 290 re f 0.85 0.91 0.6 rg 95 170 190 160 re f BT /F1 16 Tf 1 1 1 rg 95 135 Td ({text}) Tj ET BT /F1 10 Tf 0 0 0 rg 340 325 Td (REVIEW FIXTURE - NOT ARTWORK) Tj ET'.encode())
    page[NameObject('/Contents')]=writer._add_object(stream)
    page[NameObject('/Rotate')]=NumberObject(rotation)
    if annotation:
        writer.add_annotation(0,DictionaryObject({NameObject('/Type'):NameObject('/Annot'),NameObject('/Subtype'):NameObject('/Square'),NameObject('/Rect'):ArrayObject([FloatObject(n) for n in [90,120,290,150]]),NameObject('/C'):ArrayObject([FloatObject(1),FloatObject(0),FloatObject(0)]),NameObject('/F'):NumberObject(4)}))
    with open(path,'wb') as output:writer.write(output)


class ProcessorTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.root=pathlib.Path(self.tmp.name)
        self.a=self.root/'a.pdf';self.b=self.root/'b.pdf';fixture(self.a);fixture(self.b)
    def tearDown(self):self.tmp.cleanup()
    def compare(self,config=None):return processor.compare(str(self.a),str(self.b),config or {},self.root)
    def test_identical_has_no_changes(self):self.assertEqual(self.compare()['findings'],[])
    def test_text_and_pixels_change(self):
        fixture(self.b,'CHANGED COPY')
        result=self.compare();self.assertIn('text_changed',[f['kind'] for f in result['findings']]);self.assertIn('pixels_changed',[f['kind'] for f in result['findings']])
    def test_native_annotation_excluded(self):
        fixture(self.b,annotation=True);self.assertEqual(self.compare()['findings'],[])
    def test_exclusion_reduces_coverage(self):
        result=self.compare({'exclusions':[{'page':1,'geometry':{'x':0,'y':0,'width':.5,'height':.5}}]})
        self.assertEqual(result['state'],'partial');self.assertGreater(result['coverage']['excluded_fraction'],.24)
    def test_rotated_metadata(self):
        fixture(self.a,rotation=90);result=processor.inspect(str(self.a),self.root);self.assertEqual(result['pages'][0]['rotation'],90)
    def test_encrypted_rejected(self):
        writer=PdfWriter();writer.add_blank_page(width=100,height=100);writer.encrypt('private')
        with open(self.a,'wb') as file:writer.write(file)
        with self.assertRaisesRegex(ValueError,'Encrypted'):processor.inspect(str(self.a),self.root)


if __name__=='__main__':
    out=ROOT/'artifacts/fixtures';out.mkdir(parents=True,exist_ok=True)
    fixture(out/'v1.pdf');fixture(out/'v2.pdf','CORRECTED COPY')
    unittest.main()
