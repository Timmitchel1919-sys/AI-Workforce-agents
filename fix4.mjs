import fs from 'fs';
let sidebar = fs.readFileSync('ui/src/components/layout/Sidebar.tsx', 'utf8');
sidebar = sidebar.replace('NavigationIconId,', '');
sidebar = sidebar.replace('NavigationIconId', ''); // in case it was the only import
fs.writeFileSync('ui/src/components/layout/Sidebar.tsx', sidebar);
