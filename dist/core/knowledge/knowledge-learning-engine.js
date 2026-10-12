export class KnowledgeLearningEngine {
    conflicts = new Map();
    /**
     * Detects conflicting knowledge statements between items in the same scope or project.
     * Does NOT overwrite either record; flags for human or policy review.
     */
    detectConflicts(items) {
        const activeItems = items.filter((item) => item.lifecycleState !== "archived" && item.lifecycleState !== "superseded");
        const detected = [];
        for (let i = 0; i < activeItems.length; i++) {
            for (let j = i + 1; j < activeItems.length; j++) {
                const a = activeItems[i];
                const b = activeItems[j];
                // Must share project scope or be both global
                const sameProject = (a.projectId === undefined && b.projectId === undefined) ||
                    (a.projectId !== undefined && a.projectId === b.projectId);
                if (!sameProject)
                    continue;
                // Check for conflicting ADRs or conflicting facts on the same topic
                const conflict = this.evaluateItemPair(a, b);
                if (conflict) {
                    this.conflicts.set(conflict.conflictId, conflict);
                    detected.push(conflict);
                }
            }
        }
        return detected;
    }
    evaluateItemPair(a, b) {
        // 1. Explicit conflict marker
        if (a.conflictingItemIds?.includes(b.knowledgeId) || b.conflictingItemIds?.includes(a.knowledgeId)) {
            const conflictId = `conf-${[a.knowledgeId, b.knowledgeId].sort().join("-")}`;
            return {
                conflictId,
                itemAId: a.knowledgeId,
                itemBId: b.knowledgeId,
                titleA: a.title,
                titleB: b.title,
                summary: `Marked conflict between "${a.title}" and "${b.title}"`,
                detectedAt: new Date().toISOString(),
                status: "open",
            };
        }
        // 2. Direct ADR contradiction on same scope/title
        if (a.type === "architecture_decision" && b.type === "architecture_decision") {
            const sameTitle = a.title.trim().toLowerCase() === b.title.trim().toLowerCase();
            if (sameTitle && a.adr?.status === "accepted" && b.adr?.status === "accepted" && a.knowledgeId !== b.knowledgeId) {
                const conflictId = `conf-${[a.knowledgeId, b.knowledgeId].sort().join("-")}`;
                return {
                    conflictId,
                    itemAId: a.knowledgeId,
                    itemBId: b.knowledgeId,
                    titleA: a.title,
                    titleB: b.title,
                    summary: `Two conflicting accepted Architecture Decision Records found for "${a.title}"`,
                    detectedAt: new Date().toISOString(),
                    status: "open",
                };
            }
        }
        // 3. Opposing keyword assertions on shared tag/topic
        const sharedTags = a.tags.filter((t) => b.tags.includes(t));
        if (sharedTags.length > 0) {
            const aLower = a.body.toLowerCase();
            const bLower = b.body.toLowerCase();
            const opposingRules = [
                { positive: "always require approval", negative: "bypass approval" },
                { positive: "allow direct deployment", negative: "disallow direct deployment" },
                { positive: "must use postgres", negative: "must use sqlite" },
                { positive: "enforce strict authentication", negative: "disable authentication" },
                { positive: "forbidden", negative: "permitted" },
            ];
            for (const rule of opposingRules) {
                if ((aLower.includes(rule.positive) && bLower.includes(rule.negative)) ||
                    (aLower.includes(rule.negative) && bLower.includes(rule.positive))) {
                    const conflictId = `conf-${[a.knowledgeId, b.knowledgeId].sort().join("-")}`;
                    return {
                        conflictId,
                        itemAId: a.knowledgeId,
                        itemBId: b.knowledgeId,
                        titleA: a.title,
                        titleB: b.title,
                        summary: `Contradictory directives detected on shared topic [${sharedTags.join(", ")}]: "${rule.positive}" vs "${rule.negative}"`,
                        detectedAt: new Date().toISOString(),
                        status: "open",
                    };
                }
            }
        }
        return undefined;
    }
    /**
     * Resolves an identified conflict. Updates the preferred item to validated,
     * marks the rejected item as superseded, and records the resolution audit notes.
     */
    resolveConflict(conflictId, winnerItem, loserItem, resolutionNotes, resolvedBy) {
        const conflict = this.conflicts.get(conflictId) || {
            conflictId,
            itemAId: winnerItem.knowledgeId,
            itemBId: loserItem.knowledgeId,
            titleA: winnerItem.title,
            titleB: loserItem.title,
            summary: "Manual conflict resolution",
            detectedAt: new Date().toISOString(),
            status: "open",
        };
        const now = new Date().toISOString();
        const resolvedConflict = {
            ...conflict,
            status: "resolved",
            resolutionNotes,
            resolvedBy,
            resolvedAt: now,
        };
        this.conflicts.set(conflictId, resolvedConflict);
        const updatedWinner = {
            ...winnerItem,
            confidence: "verified",
            lifecycleState: "validated",
            updatedAt: now,
        };
        const updatedLoser = {
            ...loserItem,
            lifecycleState: "superseded",
            supersededById: winnerItem.knowledgeId,
            updatedAt: now,
        };
        return { updatedWinner, updatedLoser, resolvedConflict };
    }
    /**
     * Performs an evidence-based quality audit across the knowledge repository.
     * Identifies stale items, low-confidence records, and unresolved conflicts.
     */
    analyzeQuality(items) {
        const nowMs = Date.now();
        const staleThresholdMs = 90 * 24 * 60 * 60 * 1000; // 90 days
        const staleItemIds = [];
        const lowConfidenceItemIds = [];
        let verifiedCount = 0;
        let unverifiedCount = 0;
        let lowConfidenceCount = 0;
        let activeCount = 0;
        for (const item of items) {
            if (item.lifecycleState === "active" || item.lifecycleState === "validated") {
                activeCount++;
            }
            if (item.confidence === "verified") {
                verifiedCount++;
            }
            else if (item.confidence === "unverified") {
                unverifiedCount++;
            }
            else if (item.confidence === "low_confidence") {
                lowConfidenceCount++;
                lowConfidenceItemIds.push(item.knowledgeId);
            }
            const itemAgeMs = nowMs - new Date(item.updatedAt).getTime();
            if (itemAgeMs > staleThresholdMs && item.confidence !== "verified") {
                staleItemIds.push(item.knowledgeId);
            }
        }
        const detectedConflicts = this.detectConflicts(items);
        const openConflicts = detectedConflicts.filter((c) => c.status === "open");
        const recommendations = [];
        if (openConflicts.length > 0) {
            recommendations.push(`Resolve ${openConflicts.length} active knowledge conflict${openConflicts.length > 1 ? "s" : ""} to avoid contradictory agent planning.`);
        }
        if (lowConfidenceItemIds.length > 0) {
            recommendations.push(`Validate ${lowConfidenceItemIds.length} low-confidence knowledge record${lowConfidenceItemIds.length > 1 ? "s" : ""} with explicit human or execution evidence.`);
        }
        if (staleItemIds.length > 0) {
            recommendations.push(`Review ${staleItemIds.length} knowledge item${staleItemIds.length > 1 ? "s" : ""} untouched in over 90 days to ensure accuracy.`);
        }
        if (recommendations.length === 0) {
            recommendations.push("Knowledge repository is healthy, consistent, and adheres to confidence baselines.");
        }
        return {
            generatedAt: new Date().toISOString(),
            totalItems: items.length,
            activeItems: activeCount,
            verifiedItems: verifiedCount,
            unverifiedItems: unverifiedCount,
            lowConfidenceItems: lowConfidenceCount,
            staleItems: staleItemIds.length,
            conflictingItems: openConflicts.length,
            openConflictsCount: openConflicts.length,
            staleItemIds,
            lowConfidenceItemIds,
            conflicts: detectedConflicts,
            recommendations,
        };
    }
    /**
     * Scoped context retrieval for the Context Engine and Prompt Intelligence layer.
     * Enforces strict project isolation — cross-project knowledge (e.g. AIMS vs Money Mind)
     * is never returned unless explicitly marked as global scope.
     */
    retrieveScopedContext(items, query) {
        const searchTerms = query.prompt.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
        const limit = query.limit ?? 10;
        const filtered = items.filter((item) => {
            // 1. Exclude archived and superseded knowledge
            if (item.lifecycleState === "archived" || item.lifecycleState === "superseded") {
                return false;
            }
            // 2. Strict Project Scoping (AIMS knowledge cannot leak to Money Mind)
            if (query.projectId) {
                if (item.projectId && item.projectId !== query.projectId) {
                    return false;
                }
            }
            else {
                // If caller has no project scope, only return global knowledge
                if (item.projectId) {
                    return false;
                }
            }
            // 3. Scope filter if requested
            if (query.scope && item.scope !== query.scope && item.scope !== "global") {
                return false;
            }
            // 4. Tag filter
            if (query.tags && query.tags.length > 0) {
                const matchesTag = query.tags.some((t) => item.tags.includes(t));
                if (!matchesTag)
                    return false;
            }
            return true;
        });
        // Score by relevance and confidence weighting
        const scored = filtered.map((item) => {
            const haystack = `${item.title} ${item.body} ${item.tags.join(" ")}`.toLowerCase();
            let matchScore = 0;
            for (const term of searchTerms) {
                if (haystack.includes(term)) {
                    matchScore += 5;
                }
            }
            // Confidence boost
            if (item.confidence === "verified")
                matchScore += 10;
            else if (item.confidence === "high_confidence")
                matchScore += 6;
            else if (item.confidence === "medium_confidence")
                matchScore += 3;
            else if (item.confidence === "low_confidence")
                matchScore -= 2;
            return { item, matchScore };
        });
        scored.sort((a, b) => b.matchScore - a.matchScore);
        return scored.slice(0, limit).map((s) => ({ ...s.item }));
    }
    /**
     * Extracts reusable pattern proposals from operational execution records.
     * Repeated failures or successes generate structured knowledge suggestions.
     */
    extractPatterns(executions) {
        const proposals = [];
        const groupedFailures = new Map();
        const groupedSuccesses = new Map();
        for (const exec of executions) {
            const key = `${exec.action}::${exec.errorOrSummary.slice(0, 60)}`;
            if (exec.outcome === "failure") {
                const list = groupedFailures.get(key) || [];
                list.push(exec);
                groupedFailures.set(key, list);
            }
            else {
                const list = groupedSuccesses.get(key) || [];
                list.push(exec);
                groupedSuccesses.set(key, list);
            }
        }
        // Repeated failures (>= 3 times) suggest a solution / lesson learned
        for (const [key, records] of groupedFailures.entries()) {
            if (records.length >= 3) {
                const sample = records[0];
                proposals.push({
                    projectId: sample.projectId,
                    type: "lesson",
                    title: `Recurring Failure Pattern: ${sample.action}`,
                    body: `Observed ${records.length} repeated failures on action "${sample.action}". Diagnostic: ${sample.errorOrSummary}`,
                    tags: ["recurring_failure", "troubleshooting", sample.action],
                    confidence: "medium_confidence",
                    scope: sample.projectId ? "project" : "global",
                    provenance: {
                        sourceType: "workflow_result",
                        sourceUri: `tasks/${sample.taskId}`,
                    },
                    lesson: {
                        whatHappened: `Action ${sample.action} failed repeatedly.`,
                        why: sample.errorOrSummary,
                        whatWorked: "Under investigation",
                        whatFailed: sample.action,
                        whatShouldChange: "Verify dependencies and environment constraints before execution.",
                        whatShouldBeRepeated: "Automatic failure telemetry capture.",
                    },
                });
            }
        }
        // Repeated successes (>= 3 times) suggest a reusable workflow / procedure pattern
        for (const [key, records] of groupedSuccesses.entries()) {
            if (records.length >= 3) {
                const sample = records[0];
                proposals.push({
                    projectId: sample.projectId,
                    type: "pattern",
                    title: `Proven Procedure Pattern: ${sample.action}`,
                    body: `Consistently verified workflow execution (${records.length} successful runs). Execution details: ${sample.errorOrSummary}`,
                    tags: ["proven_pattern", "best_practice", sample.action],
                    confidence: "high_confidence",
                    scope: sample.projectId ? "project" : "global",
                    provenance: {
                        sourceType: "workflow_result",
                        sourceUri: `tasks/${sample.taskId}`,
                    },
                });
            }
        }
        return proposals;
    }
}
