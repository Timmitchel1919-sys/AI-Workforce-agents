import fs from 'fs';
let sidebar = fs.readFileSync('ui/src/components/layout/Sidebar.tsx', 'utf8');
sidebar = sidebar.replace('BookOpen,\n', 'BookOpen,\n  Network,\n');
fs.writeFileSync('ui/src/components/layout/Sidebar.tsx', sidebar);
