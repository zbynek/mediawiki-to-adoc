import * as fs from 'fs';

const files = fs.readdirSync("presets");

files.filter(f=>f.includes(".json")).forEach((file) => {

  const config = JSON.parse(fs.readFileSync("presets/"+file));
  const lang = file.substring(0, 2);
  if (!config.categories) {
    return;
  }
  for (const cat of config.categories) {
  console.log(`            rewrite "${cat[1].replace('^','^'+lang+'/')}" https://geogebra.github.io/docs/manual/${lang}/${cat[0]}/$1 break;`);
  }

  console.log(`            rewrite ^${lang}(/.*)?$ https://geogebra.github.io/docs/manual/${lang}/ break;\n`);
});