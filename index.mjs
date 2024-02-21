
import * as fs from 'fs';
import axios from 'axios';
import {exec} from 'child_process';
import cheerio from 'cheerio';
import * as os from 'os';
import {mkdirp} from 'mkdirp';

const fixAdmonitions = ($, selector, adocName) => {
   $(selector).each(function() {
     const block = $(this);
     block.html(`<div>[${adocName}]</div><div>====</div>${block.html()}<div>====</div>`);
     const parent = block.parent();
     if (parent[0].name == "dd") {
       parent.parent().after(block);
     }
   });
}

async function downloadImage(url, filename) {
  const response = await axios.get(url, { responseType: 'arraybuffer' });
  fs.writeFileSync(filename, response.data);
}

const htmlTransforms = [
  $ => $('.infobox,.mw-editsection,br').remove(),
  $ => $('.block-contents,.block-content,.mw-headline').attr('class', ''),
  $ => $('[data-latex]').each(function() {
    $(this).text(`stem:[${$(this).text()}]`);
  }),
  $ => fixAdmonitions($, ".block-note", "NOTE"),
  $ => fixAdmonitions($, ".example", "EXAMPLE")
]

const api = 'https://wiki.geogebra.org/s/it/api.php';
const baseUrl = 'https://wiki.geogebra.org';
const pageList = 'pages.txt';
const outputCategoryDir = 'commands';

const outputDir = process.argv[2];
if (!fs.lstatSync(outputDir).isDirectory()) {
    console.error(`Invalid directory ${outputDir}`);
    process.exit(1);
}
mkdirp(`${outputDir}/pages/`);
mkdirp(`${outputDir}/pages/${outputCategoryDir}`);
mkdirp(`${outputDir}/assets/images/`);

const pages = fs.readFileSync(fs.openSync(pageList), {encoding: 'utf8'})
    .split('\n').map(s => s.trim()).filter(Boolean);

for (const page of pages) {
  console.log(`Getting ${page}`);
  const url = `${api}?action=parse&page=${page}&format=json`;
  const content = (await axios.get(url)).data.parse.text['*'];
  const out = page.trim().replaceAll(/\s/g, '_');
  const outHtml = `${os.tmpdir()}/${out}.html`;
  const outAdoc = `${os.tmpdir()}/${out}.adoc`;
  const $ = cheerio.load(content);
  htmlTransforms.forEach(fn => fn($));
  $("img").each(function() {
     const src = $(this).attr("src");
     const baseName = src.split('/').reverse()[0];
     $(this).attr("src", `../assets/images/${baseName}`);
     downloadImage(baseUrl + src, `${outputDir}/assets/images/${baseName}`);
  });
  fs.writeFileSync(outHtml, $.html());

  exec(`pandoc -f html --columns=120 -t asciidoc ${outHtml}`, (err, adocContent, stderr) => {
    console.log(stderr);
    fs.writeFileSync(`${outputDir}/pages/${outputCategoryDir}/${out}.adoc`, `= ${page}\n\n${adocContent}`);
    fs.unlinkSync(outHtml);
  });
}
