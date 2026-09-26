import fs from 'fs';
let sidebar = fs.readFileSync('ui/src/components/layout/Sidebar.tsx', 'utf8');
sidebar = sidebar.replace('import { BookOpen,', 'import { BookOpen, Network,');
fs.writeFileSync('ui/src/components/layout/Sidebar.tsx', sidebar);
