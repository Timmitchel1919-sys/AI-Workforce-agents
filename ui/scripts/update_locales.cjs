const fs = require('fs');
const enPath = 'C:/Users/Administrator/Downloads/AI Webapp Projects/Ai worforce agents/ui/src/i18n/locales/en.ts';
const nlPath = 'C:/Users/Administrator/Downloads/AI Webapp Projects/Ai worforce agents/ui/src/i18n/locales/nl.ts';

const enStr = `,
  integrations: {
    title: "Integrations",
    description: "Manage enterprise integrations, MCP servers, and external tools.",
    tabs: {
      connectors: "Connectors",
      capabilities: "Capabilities",
      mcp: "MCP Servers",
      webhooks: "Webhooks",
      credentials: "Credentials",
      activity: "Activity"
    }
  }
};
`;

const nlStr = `,
  integrations: {
    title: "Integraties",
    description: "Beheer enterprise integraties, MCP-servers en externe tools.",
    tabs: {
      connectors: "Connectors",
      capabilities: "Mogelijkheden",
      mcp: "MCP-servers",
      webhooks: "Webhooks",
      credentials: "Referenties",
      activity: "Activiteit"
    }
  }
};
`;

let enC = fs.readFileSync(enPath, 'utf8');
enC = enC.replace(/\};\s*$/, enStr);
fs.writeFileSync(enPath, enC);

let nlC = fs.readFileSync(nlPath, 'utf8');
nlC = nlC.replace(/\};\s*$/, nlStr);
fs.writeFileSync(nlPath, nlC);
