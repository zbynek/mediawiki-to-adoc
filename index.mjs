
import * as fs from 'fs';
import axios from 'axios';
import {exec} from 'child_process';
import cheerio from 'cheerio';
import * as os from 'os';
import {mkdirp} from 'mkdirp';

const fixAdmonitions = ($, selector, adocName, headings) => {
  $(selector).each(function() {
    const block = $(this);
    for (const heading of headings) {
        $(`b:contains(\"${heading}:\")`).remove();
    }
    block.html(`<div>[${adocName}]</div><div>====</div>${block.html()}<div>====</div>`);
    const parent = block.parent();
    if (parent[0].name == 'dd') {
      parent.parent().after(block);
    }
  });
};

const axiosGet = async (url, options) => {
    try {
        return await axios.get(url, options);
    } catch (e) {
        console.log(`Could not fetch ${url}: ${e}`);
    }
}

const downloadImage = async (url, filename) => {
  const response = await axiosGet(url, {responseType: 'arraybuffer'});
  fs.writeFileSync(filename, response.data);
};

const htmlTransforms = [
  ($) => $('.infobox,.mw-editsection,br').remove(),
  ($) => $('.toc').replaceWith("<div>:toc:</div>"),
  ($) => $('.block-contents,.block-content,.mw-headline').attr('class', ''),
  ($) => $('[data-latex]').each(function() {
    $(this).text(`stem:[${$(this).text()}]`);
  }),
  ($) => $('h2 span, h3 span').each(function() {
      $(this).text() || $(this).remove();
  }),
  ($, config) => fixAdmonitions($, '.block-note', 'NOTE', config.headings),
  ($, config) => fixAdmonitions($, '.example', 'EXAMPLE', config.headings),
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
  const cleanPage = page.replaceAll(/[-\/,_\s.]+/g, '_');
  const absLink = '/' + (prefix ? prefix + '/' + cleanPage : cleanPage) + '.adoc';
  return absLink;
};


const configIt = {
  categories: [['commands', /Comando_.*/],
    ['commands', /Comandi_.*/],
    ['tools', /Strumento_.*/],
    ['tools', /Strumenti_.*/],
  ],
  api: 'https://wiki.geogebra.org/s/it/api.php',
  baseUrl: 'https://wiki.geogebra.org',
  linkPrefix: '/it',
  headings: ['Note', 'Esempio'],
  outputDir: '../manual/it/modules/ROOT',
  pages: ['Manuale']
};

const configEn = {
    categories: [
      ['commands', /.*_Command$/],
      ['commands', /.*_Commands$/],
      ['tools', /.*_Tool$/],
      ['tools', /.*_Tools$/],
   ],
   api: 'https://wiki.geogebra.org/s/en/api.php',
   baseUrl: 'https://wiki.geogebra.org',
   linkPrefix: '/en',
   headings: ['Note', 'Example'],
   outputDir: '../manual/en/modules/ROOT',
   pages: ['Input_Bar'],
};
const config = process.argv[2] == 'it' ? configIt : configEn;
const categories = config.categories;
const baseUrl = config.baseUrl;
const api = config.api;
const linkPrefix = config.linkPrefix;
const outputDir = config.outputDir;

if (!fs.lstatSync(outputDir).isDirectory()) {
  console.error(`Invalid directory ${outputDir}`);
  process.exit(1);
}
mkdirp(`${outputDir}/pages/`);
categories.forEach((cat) => mkdirp(`${outputDir}/pages/${cat[0]}`));
mkdirp(`${outputDir}/assets/images/`);

const pages = config.pages;
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
  const parsed = (await axiosGet(url)).data.parse;
  if (!parsed) {
    console.log('  Fetch failed');
    continue;
  }
  const content = parsed.text['*'];
  const out = page.trim().replace(/[-\/,_\s.]+/g, '_');
  const outHtml = `${os.tmpdir()}/${out}.html`;
  const $ = cheerio.load(content);
  htmlTransforms.forEach((fn) => fn($, config));
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
