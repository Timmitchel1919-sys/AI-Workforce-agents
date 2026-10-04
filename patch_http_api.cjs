const fs = require('fs');
let content = fs.readFileSync('api/http-api.ts', 'utf8');
content = content.replace(/return send\(res, 200, await options\.itsm\.listServices\(principal\), correlationId\);\r?\n\s*/g, '');
content = content.replace(/return send\(res, 200, await options\.itsm\.createService\(principal, body as any\), correlationId\);\r?\n\s*/g, '');
content = content.replace(/return send\(res, 200, await options\.itsm\.listIncidents\(principal, serviceId \|\| undefined\), correlationId\);\r?\n\s*/g, '');
content = content.replace(/return send\(res, 200, await options\.itsm\.createIncident\(principal, body as any\), correlationId\);\r?\n\s*/g, '');
content = content.replace(/return send\(res, 200, await options\.itsm\.listChangeRequests\(principal\), correlationId\);\r?\n\s*/g, '');
content = content.replace(/return send\(res, 200, await options\.itsm\.createChangeRequest\(principal, body as any\), correlationId\);\r?\n\s*/g, '');
fs.writeFileSync('api/http-api.ts', content);
