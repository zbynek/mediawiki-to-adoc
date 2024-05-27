//const files = ["ar", "bg", "bs", "ca", "cs", "da", "de", "el", "en", "es", "et", "eu", "fa", "fi", "fr", "gl", "he", "hi", "hr", "hu", "id", "is", "it", "ja", "kk", "ko", "lt", "mk", "mn", "ms", "nb", "nl", "nn", "pl", "pt", "ru", "sk", "sl", "sr", "sv", "tr", "vi", "zh"];
const files = ['cs'];
const fs = require('fs');
const Properties = require('@js.properties/properties');

const singlePattern = prop => prop?.replaceAll(/([)(])/g, "\\$1").replace('%0', '(.*)');
const groupPattern = prop => prop?.replaceAll(/([)(])/g, "\\$1").replace('%0', '.*');

for (const conf of files) {
    const config = JSON.parse(fs.readFileSync(`presets/${conf}.json`, 'utf8'));
    console.log(config);
    const input = fs.readFileSync(`wiki/wiki_${conf}.properties`, 'latin1');
    let output = Properties.parseToProperties(input);
    config.categories = [
                            ["commands", `^${singlePattern(output['CommandPattern'])}$`],
                            ["commands", `^(${groupPattern(output['CommandsPattern'])})$`],
                            ["tools", `^${singlePattern(output['ToolPattern'])}$`],
                            ["tools", `^(${groupPattern(output['ToolsPattern'])})$`]
                          ];
    config.headings = [output['Note'], output['Example']];
    config.importCategories = [`Category:${output['Commands']}`, `Category:${output['Tools']}`];
    fs.writeFileSync(`presets/${conf}.json`, JSON.stringify(config, null, 2), 'utf8');
    console.log(config);
    console.log(output['CommandsPattern']);
    console.log(output['CommandsPattern'].replaceAll(/([)(])/g, "\\$1"));
}