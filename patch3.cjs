const fs = require('fs');
const glob = require('glob');

let count = 0;
for (const file of glob.sync('tests/**/*.ts')) {
  let content = fs.readFileSync(file, 'utf8');
  let original = content;

  // matches id: "something", or id: 'something',
  content = content.replace(/(id:\s*['"`][^'"`]+['"`],)/g, '$1 organizationId: "org-1",');
  
  // matches name: "something",
  // WorkflowDraft has name but no id in draft.
  content = content.replace(/(name:\s*['"`][^'"`]+['"`],)/g, '$1 organizationId: "org-1",');

  if (content !== original) {
    fs.writeFileSync(file, content);
    count++;
  }
}
console.log('Fixed', count, 'files aggressively');

