import fs from 'fs';

// 1. Sidebar.tsx
let sidebar = fs.readFileSync('ui/src/components/layout/Sidebar.tsx', 'utf8');
sidebar = sidebar.replace('"spatial-graph": Network', '"spatial-graph": Network as any');
fs.writeFileSync('ui/src/components/layout/Sidebar.tsx', sidebar);

// 2. spatialGraphClient.ts
let client = fs.readFileSync('ui/src/features/spatial-graph/api/spatialGraphClient.ts', 'utf8');
client = client.replace('import { get } from "../../../api/client";', 'import { apiClient } from "../../../api/client";');
client = client.replace('import { WorkforceGraphProjection }', 'import type { WorkforceGraphProjection }');
client = client.replace('get<WorkforceGraphProjection>', 'apiClient.get<WorkforceGraphProjection>');
fs.writeFileSync('ui/src/features/spatial-graph/api/spatialGraphClient.ts', client);

// 3. SpatialGraphView.tsx
let view = fs.readFileSync('ui/src/features/spatial-graph/components/SpatialGraphView.tsx', 'utf8');
view = view.replace('import { WorkforceGraphProjection, WorkforceGraphNode, WorkforceGraphEdge }', 'import type { WorkforceGraphProjection, WorkforceGraphNode, WorkforceGraphEdge }');
view = view.replace('import React, { useMemo, useRef, useState }', 'import { useMemo, useRef, useState }');
view = view.replace('import { Canvas, useFrame }', 'import { Canvas }');
view = view.replace('import { OrbitControls, Text, Html }', 'import { OrbitControls, Html }');
view = view.replace(/<line key=\{edge\.id\} geometry=\{geometry\} material=\{lineMaterial\} \/>/g, '<primitive key={edge.id} object={new THREE.Line(geometry, lineMaterial)} />');
fs.writeFileSync('ui/src/features/spatial-graph/components/SpatialGraphView.tsx', view);

// 4. useSpatialGraph.ts
let hook = fs.readFileSync('ui/src/features/spatial-graph/hooks/useSpatialGraph.ts', 'utf8');
hook = hook.replace('import { WorkforceGraphProjection }', 'import type { WorkforceGraphProjection }');
fs.writeFileSync('ui/src/features/spatial-graph/hooks/useSpatialGraph.ts', hook);

// 5. SpatialGraphPage.tsx
let page = fs.readFileSync('ui/src/pages/SpatialGraph/SpatialGraphPage.tsx', 'utf8');
page = page.replace('import React, { useState }', 'import { useState }');
page = page.replace('import { useTranslation } from "react-i18next";', 'import { useI18n } from "../../i18n";');
page = page.replace('import { PageHeader } from "../../components/layout/PageHeader";', 'import PageHeader from "../../components/layout/PageHeader";');
page = page.replace('import { WorkforceGraphNode }', 'import type { WorkforceGraphNode }');
page = page.replace('const { t } = useTranslation();', 'const { t } = useI18n();');
fs.writeFileSync('ui/src/pages/SpatialGraph/SpatialGraphPage.tsx', page);
