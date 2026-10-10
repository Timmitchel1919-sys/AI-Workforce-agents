export interface KnowledgeRecord {
  id: string;
  domain: string;
  content: string;
  metadata: Record<string, any>;
  provenance: {
    source: string;
    timestamp: number;
    author: string;
  };
}

export class KnowledgeEngine {
  private records: Map<string, KnowledgeRecord> = new Map();

  // INGESTION -> NORMALIZATION -> KNOWLEDGE RECORDS
  ingest(
    domain: string,
    content: string,
    source: string,
    author: string,
  ): KnowledgeRecord {
    const normalizedContent = content.trim().toLowerCase();
    const id = `rec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const record: KnowledgeRecord = {
      id,
      domain,
      content: normalizedContent,
      metadata: {},
      provenance: {
        source,
        timestamp: Date.now(),
        author,
      },
    };

    this.records.set(id, record);
    return record;
  }

  // SEARCH -> RETRIEVAL
  search(query: string, domain?: string): KnowledgeRecord[] {
    const normalizedQuery = query.toLowerCase();
    const results: KnowledgeRecord[] = [];

    for (const record of this.records.values()) {
      if (domain && record.domain !== domain) continue;
      if (record.content.includes(normalizedQuery)) {
        results.push(record);
      }
    }

    return results;
  }

  // CONTEXT ENGINE -> AGENT INTEGRATION
  getContext(query: string): string {
    const results = this.search(query);
    if (results.length === 0) return "No relevant context found.";

    return results.map((r) => `[${r.domain}] ${r.content}`).join("\n");
  }
}
