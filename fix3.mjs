import fs from 'fs';

// 1. Sidebar.tsx
let sidebar = fs.readFileSync('ui/src/components/layout/Sidebar.tsx', 'utf8');
sidebar = sidebar.replace('"spatial-graph": Network as any', '"spatial-graph": Network');
sidebar = sidebar.replace('Record<NavigationIconId, LucideIcon> =', 'Record<string, LucideIcon> =');
fs.writeFileSync('ui/src/components/layout/Sidebar.tsx', sidebar);

// 2. spatialGraphClient.ts
let client = fs.readFileSync('ui/src/features/spatial-graph/api/spatialGraphClient.ts', 'utf8');
client = client.replace('import { apiClient } from "../../../api/client";', 'import { apiRequest } from "../../../api/client";');
client = client.replace('apiClient.get<WorkforceGraphProjection>', 'apiRequest<WorkforceGraphProjection>');
fs.writeFileSync('ui/src/features/spatial-graph/api/spatialGraphClient.ts', client);
