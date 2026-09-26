import fs from 'fs';
['en', 'nl'].forEach(lang => {
  let p = 'ui/src/i18n/locales/' + lang + '.ts';
  let c = fs.readFileSync(p, 'utf8');
  c = c.replace('knowledge:', 'spatialGraph: "Spatial Graph",\n    knowledge:');
  fs.writeFileSync(p, c);
});
