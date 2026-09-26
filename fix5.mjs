import fs from 'fs';
let sidebar = fs.readFileSync('ui/src/components/layout/Sidebar.tsx', 'utf8');
sidebar = sidebar.replace('"spatial-graph": Network', '"spatial-graph": Network');
sidebar = sidebar.replace('import { BookOpen,', 'import { BookOpen, Network,');
sidebar = sidebar.replace('knowledge: BookOpen,', 'knowledge: BookOpen,\n  "spatial-graph": Network as any,');
fs.writeFileSync('ui/src/components/layout/Sidebar.tsx', sidebar);
