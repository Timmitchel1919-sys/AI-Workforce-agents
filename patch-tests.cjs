const fs = require('fs');
const glob = require('glob');

const testFiles = glob.sync('tests/**/*.ts');
let count = 0;
for (const file of testFiles) {
  let content = fs.readFileSync(file, 'utf8');
  let original = content;

  // Agent mocks
  content = content.replace(/(id:\s*['"`][^'"`]+['"`],)\n(\s*)(name:\s*['"`])/g, '$1\n$2organizationId: "org-1",\n$2$3');
  content = content.replace(/id: id,\n(\s*)name:/g, 'id: id,\n$1organizationId: "org-1",\n$1name:');
  
  // Workflow mocks
  content = content.replace(/(name:\s*['"`][^'"`]+['"`],)\n(\s*)(description:\s*['"`])/g, '$1\n$2organizationId: "org-1",\n$2$3');
  
  // Software factory specific Agent casts
  content = content.replace(/as Agent \| AgentDescriptor/g, '& { organizationId: "org-1" } as Agent | AgentDescriptor');
  
  if (content !== original) {
    fs.writeFileSync(file, content);
    count++;
  }
}
console.log('Modified', count, 'test files');

