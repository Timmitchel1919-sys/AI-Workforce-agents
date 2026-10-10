const fs = require('fs');
const files = [
  'src/pages/Auth/AuthPage.css',
  'src/pages/Landing/LandingPage.css',
  'src/pages/Settings/SettingsPage.css'
];

files.forEach(file => {
  let content = fs.readFileSync(file, 'utf8');
  content = content.replace(/rgba\((?:100,\s*170,\s*255|47,\s*123,\s*255|106,\s*174,\s*255|32,\s*88,\s*214|8,\s*26,\s*78|8,\s*20,\s*44|20,\s*60,\s*160),\s*([0-9.]+)\)/g, 'rgba(255, 255, 255, )');
  content = content.replace(/#07142c/g, '#111');
  content = content.replace(/#a9d0ff/g, '#fff');

  // Settings page uses some specific light colors for themes
  content = content.replace(/#e2ebfc/g, '#1a1a1a');
  content = content.replace(/#d4e2f9/g, '#1a1a1a');
  content = content.replace(/#dfd6f8/g, '#1a1a1a');
  content = content.replace(/#eef4ff/g, '#1a1a1a');
  content = content.replace(/#2767df/g, '#333');
  content = content.replace(/#4a2da8/g, '#333');
  content = content.replace(/rgba\(248,\s*251,\s*255,\s*0\.85\)/g, 'rgba(20, 20, 20, 0.85)');
  content = content.replace(/rgba\(45,\s*88,\s*165,\s*0\.14\)/g, 'rgba(255, 255, 255, 0.14)');

  fs.writeFileSync(file, content);
});
