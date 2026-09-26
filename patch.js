const fs = require('fs');
let code = fs.readFileSync('ui/src/config/navigation.ts', 'utf8');
code = code.replace('| "settings";', '| "settings"\n  | "spatial-graph";');
code = code.replace('{ labelKey: "nav.knowledge",', '{ labelKey: "nav.spatialGraph" as MessageKey, route: "/graph", icon: "spatial-graph", section: "main" },\n  { labelKey: "nav.knowledge",');
fs.writeFileSync('ui/src/config/navigation.ts', code);

let routerCode = fs.readFileSync('ui/src/app/router.tsx', 'utf8');
routerCode = routerCode.replace('const ProjectDetailPage = fromChunk(loadControlCenterRoutes, "ProjectDetailPage");', 'const ProjectDetailPage = fromChunk(loadControlCenterRoutes, "ProjectDetailPage");\nconst SpatialGraphPage = fromChunk(loadControlCenterRoutes, "SpatialGraphPage");');
routerCode = routerCode.replace('{ path: "projects", element: withSuspense(<ProjectsPage />) },', '{ path: "graph", element: withSuspense(<SpatialGraphPage />) },\n      { path: "projects", element: withSuspense(<ProjectsPage />) },');
fs.writeFileSync('ui/src/app/router.tsx', routerCode);
