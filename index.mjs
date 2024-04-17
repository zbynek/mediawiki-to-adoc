
import * as fs from 'fs';
import axios from 'axios';
import {exec} from 'child_process';
import cheerio from 'cheerio';
import * as os from 'os';
import {mkdirp} from 'mkdirp';
import axiosRetry from 'axios-retry';
const interwiki = JSON.parse(fs.readFileSync('./interwiki.json'));

axiosRetry(axios, {retries: 3});

const fixAdmonitions = ($, selector, adocName, headings) => {
  $(selector).each(function() {
    const block = $(this);
    for (const heading of headings) {
      $(`b:contains(\"${heading}:\")`).remove();
    }
    block.html(`<div>[${adocName}]</div>====<div>${block.html()}</div>====\n`);
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
};

const downloadImage = async (url, filename) => {
  const response = await axiosGet(url, {responseType: 'arraybuffer'});
  fs.writeFileSync(filename, response.data);
};

const htmlTransforms = [
  ($) => $('.infobox,.mw-editsection,br').remove(),
  ($) => $('.toc').replaceWith('<div>:toc:</div>'),
  ($) => $('.block-contents,.block-content,.mw-headline').attr('class', ''),
  ($) => $('[data-latex]').each(function() {
    $(this).text(`stem:[${$(this).text()}]`);
  }),
  ($) => $('code').each(function() {
    $(this).text('++' + $(this).text() + '++');
  }),
  ($) => $('h2 span, h3 span, h4 span').each(function() {
    $(this).text() || $(this).remove();
    $(this).attr('id', '');
  }),
  ($) => $('a img').each(function() {
    if ($(this).parent().attr('href').includes('File:')) {
      $(this).parent().replaceWith($(this));
    }
  }),
  ($, config) => fixAdmonitions($, '.block-note', 'NOTE', config.headings),
  ($, config) => fixAdmonitions($, '.example', 'EXAMPLE', config.headings),
];

const getCategoryPrefix = (page, categories) => {
  for (const category of categories) {
    if (page.match(category[1])) {
      return category[0] + '/';
    }
  }
  return '';
};

const simplifyName = (page, categories) => {
  const specialChars = /[-\/,_\s.]+/g;
  for (const category of categories) {
    if (page.match(category[1])) {
      return page.replace(category[1], '$1').replace(specialChars, '_');
    }
  }
  return page.replace(specialChars, '_');
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
  const cleanPage = simplifyName(page, categories);
  const absLink = '/' + prefix + cleanPage + '.adoc';
  return absLink;
};


const configIt = {
  categories: [['commands', /^Comando_(.*)$/],
    ['commands', /^(Comandi_.*)$/],
    ['tools', /^Strumento_(.*)$/],
    ['tools', /^(Strumenti_.*)$/],
  ],
  api: 'https://wiki.geogebra.org/s/it/api.php',
  baseUrl: 'https://wiki.geogebra.org',
  linkPrefix: '/it',
  headings: ['Note', 'Esempio'],
  outputDir: '../manual/it/modules/ROOT',
  importCategories: ['Category:Comandi', 'Category:Strumenti'],
};

const configEn = {
  categories: [
    ['commands', /^(.*)_Command$/],
    ['commands', /^(.*_Commands)$/],
    ['tools', /^(.*)_Tool$/],
    ['tools', /(.*_Tools)$/],
  ],
  api: 'https://wiki.geogebra.org/s/en/api.php',
  baseUrl: 'https://wiki.geogebra.org',
  linkPrefix: '/en',
  headings: ['Note', 'Example'],
  outputDir: '../manual/en/modules/ROOT',
  importCategories: ['Category:Commands', 'Category:Tools'],
};

const configRef = {
  api: 'https://wiki.geogebra.org/s/en/api.php',
  baseUrl: 'https://wiki.geogebra.org',
  linkPrefix: '/en',
  headings: ['Note', 'Example'],
  outputDir: '../integration/reference/modules/ROOT',
  pages: [
  // 'Reference:GeoGebra_App_Parameters', 'Reference:GeoGebra_Apps_Embedding',
  // 'Reference:GeoGebra_Apps_API', 'Reference:Toolbar',
  // 'Reference:File_Format',
  // 'Reference:XML_tags_in_geogebra.xml',
  // 'Reference:XML_tags_in_geogebra_macro.xml',
  // 'Reference:Common_XML_tags_and_types'
  // 'Reference:Command_Line_Arguments',
  // 'Reference:GeoGebra_Installation',
  // 'Reference:GeoGebra_Mass_Installation',
  // 'Reference:XML_Glossary',
    'Reference:Material_Embedding_(Iframe)',
  ],
};

const config = process.argv[2] == 'ref' ? configRef :
(process.argv[2] == 'it' ? configIt : configEn);
const categories = config.categories || [];
const baseUrl = config.baseUrl;
const api = config.api;
const linkPrefix = config.linkPrefix;
const outputDir = config.outputDir;

const pageToId = {};
const idToEnglishLink = {};
const wikiId = linkPrefix.replace('/', 'gg');
for (const iwItem of interwiki) {
  if (iwItem.ips_site_id == 'ggen') {
    const normalized = iwItem.ips_site_page.replaceAll(' ', '_');
    idToEnglishLink[iwItem.ips_item_id] = getCategoryPrefix(normalized, configEn.categories) +
        simplifyName(normalized, configEn.categories);
  }
  if (iwItem.ips_site_id == wikiId) {
    pageToId[simplifyName(iwItem.ips_site_page, [])] = iwItem.ips_item_id;
  }
}
if (!fs.lstatSync(outputDir).isDirectory()) {
  console.error(`Invalid directory ${outputDir}`);
  process.exit(1);
}
mkdirp(`${outputDir}/pages/`);
categories.forEach((cat) => mkdirp(`${outputDir}/pages/${cat[0]}`));
mkdirp(`${outputDir}/assets/images/`);

const pages = config.pages || [];
for (const cat of config.importCategories || []) {
  let continuation = '';
  do {
    const pageList = (await axiosGet(`${api}?action=query&list=categorymembers&cmtitle=` +
    `${cat}&cmlimit=500&format=json${continuation}`)).data;
    continuation = '';
    for (const [key, val] of Object.entries(pageList['continue'] || {})) {
      continuation += `&${key}=${val}`;
    }
    for (const page of pageList.query.categorymembers) {
      pages.push(page.title.replaceAll(' ', '_'));
    }
  } while (continuation);
}
config.pages;
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
  const out = simplifyName(page.trim(), categories);
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
  const pageId = pageToId[simplifyName(page, [])];
  console.log(`  Converting ${pageId}`);
  const meta = [idToEnglishLink[pageId] ? `:page-en: ${idToEnglishLink[pageId]}` : null,
    `ifdef::env-github[:imagesdir: ${linkPrefix}/modules/ROOT/assets/images]`]
      .filter(Boolean).join('\n');
  exec(`pandoc -f html --columns=120 -t asciidoc '${outHtml}'`, (err, adocContent, stderr) => {
    console.log(stderr.trim());
    const cleanContent = adocContent.replaceAll('link:/', 'xref:/')
        .replaceAll('  +\n', '')
        .replace(/\[(\w+)\]\n\n==/g, '[$1]\n==');
    fs.writeFileSync(`${outputDir}/pages/${outputCategoryDir}${out}.adoc`,
        `= ${page.replaceAll('_', ' ')}\n${meta}\n\n${cleanContent}`);
    fs.unlinkSync(outHtml);
  });
}
