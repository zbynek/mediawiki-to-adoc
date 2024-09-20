
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
  ($) => $('.infobox,.mw-editsection,br,.box.info').remove(),
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
  ($) => $('a img').each(function() { // link to File: namespace, different in each language
    if ($(this).parent().attr('href').replace(/https?:/,'').includes(':')) {
      $(this).parent().replaceWith($(this));
    }
  }),
  ($, config) => fixAdmonitions($, '.block-note', 'NOTE', config.headings),
  ($, config) => fixAdmonitions($, '.example', 'EXAMPLE', config.headings),
  ($) => $('table.mbox').each(function() {
      const block = $(this);
      const parent = block.parent();
      if (parent[0].name == 'dd') {
        parent.parent().after(block);
      }
  }),
  ($) => $('.mbox-text').each(function() {
       if ($(this).text().includes('not yet translated')) {
           $(this).text("Some content was not yet translated.")
       }
  }),

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
  const specialChars = /[-\/,_\s.&']+/g;
  for (const category of categories) {
    if (page.match(category[1])) {
      return page.replace(category[1], '$1').replace(specialChars, '_');
    }
  }
  return page.replace(specialChars, '_');
};

const resolveLink = (link, sourcePage, linkPrefix, categories, pages) => {
  if (!link || link.includes('//')) {
    if (link && link.startsWith('http://en.wikipedia.org/')) {
        return link.replace('http:', 'https:');
    }
    console.log(`  Not an internal link: '${link}'`);
    return link;
  }
  const page = decodeURIComponent(link.replace(linkPrefix, '').replace(/^\//, '')
      .trim().replaceAll(' ', '_').split('#')[0]);
  if (page && pages.indexOf(page) == -1 && !page.includes('.php') && !page.includes(':')) {
    console.log('  Adding to queue: ' + page);
    pages.push(page, '');
  }
  const prefix = getCategoryPrefix(page, categories);
  const cleanPage = simplifyName(page, categories);
  const absLink = '/' + prefix + cleanPage + '.adoc';
  return absLink;
};


const configEn = JSON.parse(fs.readFileSync(`presets/en.json`));
const config = JSON.parse(fs.readFileSync(`presets/${process.argv[2]}.json`));
const categories = config.categories || [];
categories.forEach(cat => {cat[1] = new RegExp(cat[1].replaceAll(' ', '_'))});
configEn.categories.forEach(cat => {cat[1] = new RegExp(cat[1].replaceAll(' ', '_'))});
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
mkdirp(`${outputDir}/pages/`);
categories.forEach((cat) => mkdirp(`${outputDir}/pages/${cat[0]}`));
mkdirp(`${outputDir}/assets/images/`);

const pages = config.pages || [];
if (config.restricted) {
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
} else {
  let continuation = '';
  do {
    const pageList = (await axiosGet(`${api}?action=query&generator=allpages&prop=info&format=json${continuation}`)).data;
    continuation = '';
    for (const [key, val] of Object.entries(pageList['continue'] || {})) {
      continuation += `&${key}=${val}`;
    }
    for (const page of Object.values(pageList.query.pages)) {
      if (typeof page.redirect == "undefined") {
        pages.push(page.title.replaceAll(' ', '_'));
      }
    }
  } while (continuation);
}

let processed = 0;
while (processed < pages.length) {
  const page = pages[processed];
  processed++;
  if (!page) {
    continue;
  }
  console.log(`Getting '${page}' (${processed} / ${pages.length})`);
  const outputCategoryDir = getCategoryPrefix(page, categories);
  const url = `${api}?action=parse&page=${encodeURIComponent(page)}&format=json`;
  const parsed = (await axiosGet(url)).data.parse;
  if (!parsed) {
    console.log(`  Fetch failed: ${url}`);
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
  const fullHtml = $.html();
  let partial = false;
  $('.mbox-text').each(function() {
         if ($(this).text().includes('not yet translated')) {
             partial = true;
             $(this).remove();
         }
    })
  $("dt,h2").remove();
  if (partial) {
     $("li a").remove();
  }
  const translatedText = $.text().trim();
  if (!translatedText.length) {
    console.log("  Skipping empty doc");
    continue;
  }
    fs.writeFileSync(outHtml, fullHtml);
  const pageId = pageToId[simplifyName(page, [])];
  console.log(`  Converting ${translatedText.length} characters`);
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
