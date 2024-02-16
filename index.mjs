
import * as fs from 'fs';
import axios from 'axios';
import {exec} from 'child_process';
import cheerio from 'cheerio';
import * as os from 'os';


const api = 'https://wiki.geogebra.org/s/en/api.php';
const pageList = 'pages.txt';

const pages = fs.readFileSync(fs.openSync(pageList), {encoding: 'utf8'})
    .split('\n');

for (const page of pages) {
  console.log(`Getting ${page}`);
  const url = `${api}?action=parse&page=${page}&format=json`;
  const content = (await axios.get(url)).data.parse.text['*'];
  const out = page.trim().replaceAll(/\s/g, '_');
  const outHtml = `${os.tmpdir()}/${out}.html`;
  const $ = cheerio.load(content);
  $('.infobox').remove();
  fs.writeFileSync(outHtml, $.html());

  exec(`pandoc -f html -t asciidoc -o out/${out}.adoc ${outHtml}`, () => {
    fs.unlinkSync(outHtml);
  });
}
