
import * as fs from 'fs';
import axios from 'axios';
import {exec} from 'child_process';
import cheerio from 'cheerio';
import * as os from 'os';
import {mkdirp} from 'mkdirp';

const fixAdmonitions = ($, selector, adocName) => {
  $(selector).each(function() {
    const block = $(this);
    const heading = /\*(Note|Example):\*\s*/g;
    $("b:contains(\"Note:\")").remove();
    $("b:contains(\"Example:\")").remove();
    block.html(`<div>[${adocName}]</div><div>====</div>${block.html()}<div>====</div>`);
    const parent = block.parent();
    if (parent[0].name == 'dd') {
      parent.parent().after(block);
    }
  });
};

const downloadImage = async (url, filename) => {
  const response = await axios.get(url, {responseType: 'arraybuffer'});
  fs.writeFileSync(filename, response.data);
};

const htmlTransforms = [
  ($) => $('.infobox,.mw-editsection,br').remove(),
  ($) => $('.block-contents,.block-content,.mw-headline').attr('class', ''),
  ($) => $('[data-latex]').each(function() {
    $(this).text(`stem:[${$(this).text()}]`);
  }),
  ($) => fixAdmonitions($, '.block-note', 'NOTE'),
  ($) => fixAdmonitions($, '.example', 'EXAMPLE'),
];

const getCategoryPrefix = (page, categories) => {
  for (const category of categories) {
    if (page.match(category[1])) {
      return category[0];
    }
  }
  return '';
};

const resolveLink = (link, sourcePage, linkPrefix, categories, pages) => {
  if (!link || link.includes('//')) {
    console.log(`  Not an internal link: '${link}'`);
    return link;
  }
  const page = link.replace(linkPrefix, '').replace(/^\//, '')
      .trim().replaceAll(' ', '_').split('#')[0];
  if (page && pages.indexOf(page) == -1 && !page.includes('.php') && !page.includes(':')) {
    console.log('  Adding to queue: ' + page);
    pages.push(page, '');
  }
  const prefix = getCategoryPrefix(page, categories);
  const absLink = '/' + (prefix ? prefix + '/' + page : page) + '.adoc';
  return absLink;
};

const api = 'https://wiki.geogebra.org/s/en/api.php';
const baseUrl = 'https://wiki.geogebra.org';
const linkPrefix = '/en';
const pageList = 'pages.txt';

const categoriesIt = [
  ['commands', /Comando_.*/],
  ['commands', /Comandi_.*/],
  ['tools', /Strumento_.*/],
  ['tools', /Strumenti_.*/],
];

const categoriesEn = [
  ['commands', /.*_Command$/],
  ['commands', /.*_Commands$/],
  ['tools', /.*_Tool$/],
  ['tools', /.*_Tools$/],
];
const categories = categoriesEn;

const outputDir = process.argv[2];
if (!fs.lstatSync(outputDir).isDirectory()) {
  console.error(`Invalid directory ${outputDir}`);
  process.exit(1);
}
mkdirp(`${outputDir}/pages/`);
categories.forEach((cat) => mkdirp(`${outputDir}/pages/${cat[0]}`));
mkdirp(`${outputDir}/assets/images/`);

const pages = fs.readFileSync(fs.openSync(pageList), {encoding: 'utf8'})
    .split('\n').map((s) => s.trim()).filter(Boolean);
let processed = 0;
while (processed < pages.length) {
  const page = pages[processed];
  processed++;
  if (!page) {
    continue;
  }
  console.log(`Getting '${page}' (${processed} / ${pages.length})`);
  const outputCategoryDir = getCategoryPrefix(page, categories);
  const url = `${api}?action=parse&page=${page}&format=json`;
  const parsed = (await axios.get(url)).data.parse;
  if (!parsed) {
    console.log('  Fetch failed');
    continue;
  }
  const content = parsed.text['*'];
  const out = page.trim().replaceAll(/[\/\s]/g, '_');
  const outHtml = `${os.tmpdir()}/${out}.html`;
  const $ = cheerio.load(content);
  htmlTransforms.forEach((fn) => fn($));
  $('a').each(function() {
    $(this).attr('href', resolveLink($(this).attr('href'), page, linkPrefix, categories, pages));
  });
  $('img').each(function() {
    const src = $(this).attr('src');
    const baseName = src.split('/').reverse()[0];
    $(this).attr('src', `${baseName}`);
    downloadImage(baseUrl + src, `${outputDir}/assets/images/${baseName}`);
  });
  fs.writeFileSync(outHtml, $.html());
  console.log('  Converting');
  exec(`pandoc -f html --columns=120 -t asciidoc ${outHtml}`, (err, adocContent, stderr) => {
    console.log(stderr.trim());
    fs.writeFileSync(`${outputDir}/pages/${outputCategoryDir}/${out}.adoc`,
        `= ${page.replaceAll('_', ' ')}\n\n${adocContent}`.replaceAll('link:/', 'xref:/'));
    fs.unlinkSync(outHtml);
  });
}
