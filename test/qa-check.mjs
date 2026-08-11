import fs from "node:fs";
import JSZip from "jszip";

const zip = await JSZip.loadAsync(fs.readFileSync("test/output/sample.pptx"));
const s1 = await zip.file("ppt/slides/slide1.xml").async("string");

const re = /<p:sp>([\s\S]*?)<\/p:sp>/g;
let m, i = 0;
const info = [];
while ((m = re.exec(s1))) {
  const sp = m[1];
  i++;
  const prst = (sp.match(/prst="([^"]+)"/) || [])[1];
  const off = sp.match(/<a:off x="(\d+)" y="(\d+)"\/>/);
  const ext = sp.match(/<a:ext cx="(\d+)" cy="(\d+)"\/>/);
  const rot = (sp.match(/rot="([^"]+)"/) || [])[1];
  const text = (sp.match(/<a:t>([^<]*)<\/a:t>/) || [])[1];
  const hasShadow = /<a:effectLst><a:outerShdw/.test(sp);
  info.push(`#${i} ${prst || "?"} off=(${off ? off[1] : "-"},${off ? off[2] : "-"}) ext=(${ext ? ext[1] : "-"},${ext ? ext[2] : "-"}) rot=${rot || 0} shadow=${hasShadow} text=${text || ""}`);
}
console.log(info.join("\n"));
console.log("---- has <p:pic>:", s1.includes("<p:pic>"));
console.log("---- has blip:", /<a:blip/.test(s1));
console.log("---- roundRect radius:", (s1.match(/<a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val (\d+)"/) || [])[1]);
console.log("---- charSpacing present:", s1.includes("spc="));
console.log("---- lineSpacingMultiple:", s1.includes("lnSpc"));
