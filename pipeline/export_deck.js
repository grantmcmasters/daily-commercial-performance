/* Headless slide export: renders the same PDF deck the "Export slides" button builds, without a browser.
   Loads index.html, data.js and app.js in jsdom, swaps the page's IO layer for disk reads, rasterizes
   svg logos with resvg, and writes the PDF.

   usage: node pipeline/export_deck.js [out.pdf]        (run from the repo root or anywhere; paths resolve to the repo) */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');
const { Resvg } = require('@resvg/resvg-js');

const APP = path.resolve(__dirname, '..');
const OUT = path.resolve(process.argv[2] || path.join(APP, 'deck.pdf'));

let html = fs.readFileSync(path.join(APP, 'index.html'), 'utf8');
html = html.replace(/<script src="[^"]*"><\/script>/g, '').replace(/<link [^>]*>/g, '');
const vc = new VirtualConsole(); vc.sendTo(console, { omitJSDOMErrors: true });
const dom = new JSDOM(html, { pretendToBeVisual: true, runScripts: 'outside-only', virtualConsole: vc });
const W = dom.window;
global.window = W; global.document = W.document; global.navigator = W.navigator; global.self = W;
global.HTMLElement = W.HTMLElement; global.Node = W.Node; global.DOMParser = W.DOMParser; global.XMLSerializer = W.XMLSerializer; global.Image = W.Image;
W.requestAnimationFrame = W.requestAnimationFrame || (cb => setTimeout(cb, 0));
const { jsPDF } = require('jspdf');
W.jspdf = { jsPDF };
require('svg2pdf.js');

/* text measurement: jsdom has no canvas and no getBBox, so both routes answer with jsPDF's own metrics */
const FONTS = path.join(APP, 'fonts');
const REG = [['Montserrat-Medium.ttf', 'Montserrat', 'normal'], ['Montserrat-Medium.ttf', 'Montserrat', '500normal'], ['Montserrat-SemiBold.ttf', 'Montserrat', '600normal'], ['Montserrat-Bold.ttf', 'Montserrat', 'bold'], ['Montserrat-ExtraBold.ttf', 'Montserrat', '800normal'], ['Lora-Italic.ttf', 'Lora', 'italic'], ['Lora-Regular.ttf', 'Lora', 'normal'], ['Lora-Bold.ttf', 'Lora', 'bold']];
const meas = new jsPDF({ orientation: 'landscape', unit: 'in', format: [13.333, 7.5] });
REG.forEach(r => { meas.addFileToVFS(r[0], fs.readFileSync(path.join(FONTS, r[0])).toString('base64')); meas.addFont(r[0], r[1], r[2]); });
function widthPx(text, fam, weight, style, px) {
  const st = (weight == 700 || weight === 'bold') ? 'bold' : (weight == 400 || weight === 'normal' || !weight) ? (style === 'italic' ? 'italic' : 'normal') : weight + 'normal';
  try { meas.setFont(fam, st); } catch (e) { meas.setFont('Montserrat', 'normal'); }
  meas.setFontSize(px * 0.75);
  return meas.getTextWidth(String(text)) * 96;
}
W.HTMLCanvasElement.prototype.getContext = function () { const ctx = { font: '' }; ctx.measureText = function (t) { const m = /^(\S+)\s+(\S+)\s+(\S+)px\s+(.+)$/.exec(ctx.font) || []; return { width: widthPx(t, (m[4] || 'Montserrat').replace(/['"]/g, ''), m[2], m[1], parseFloat(m[3] || 16)) }; }; return ctx; };
W.SVGElement.prototype.getBBox = function () { const px = parseFloat(this.getAttribute('font-size') || 16); return { x: 0, y: 0, width: widthPx(this.textContent, (this.getAttribute('font-family') || 'Montserrat'), this.getAttribute('font-weight'), this.getAttribute('font-style'), px), height: px }; };

/* svg logos become png through resvg; png and jpg pass straight through */
function rasterSvg(file) {
  const svg = fs.readFileSync(file, 'utf8');
  const r = new Resvg(svg, { fitTo: { mode: 'width', value: 900 }, background: 'rgba(0,0,0,0)' });
  const png = r.render();
  return { data: 'data:image/png;base64,' + Buffer.from(png.asPng()).toString('base64'), ratio: png.width / png.height };
}
W.__dcpIO = {
  libs: () => Promise.resolve(),
  bytes: (url) => Promise.resolve(fs.readFileSync(path.join(APP, url)).buffer.slice(0)),
  image: (p) => {
    if (!p) return Promise.resolve(null);
    if (/^data:/.test(p)) return Promise.resolve({ data: p });
    const file = path.join(APP, p);
    if (!fs.existsSync(file)) return Promise.resolve(null);
    if (/\.svg$/i.test(p)) { try { return Promise.resolve(rasterSvg(file)); } catch (e) { console.error('logo skipped', p, e.message); return Promise.resolve(null); } }
    return Promise.resolve({ data: 'data:image/' + (/\.jpe?g$/i.test(p) ? 'jpeg' : 'png') + ';base64,' + fs.readFileSync(file).toString('base64') });
  },
  save: (pdf, name) => { fs.writeFileSync(OUT, Buffer.from(pdf.output('arraybuffer'))); console.log('wrote', OUT, 'as', name); return Promise.resolve(); }
};
const errors = [];
W.addEventListener('error', e => errors.push(String(e.error || e.message)));
W.eval(fs.readFileSync(path.join(APP, 'data.js'), 'utf8'));
W.eval(fs.readFileSync(path.join(APP, 'app.js'), 'utf8'));
if (errors.length) { console.error('page errors:', errors); process.exit(1); }
W.__dcpExport().then(() => {
  console.log(W.document.getElementById('pptx-status').textContent);
  process.exit(0);
}).catch(e => { console.error('EXPORT FAILED', e && e.stack || e); process.exit(1); });
