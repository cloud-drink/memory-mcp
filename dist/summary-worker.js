#!/usr/bin/env node
import { db } from "./db.js";
import { summarizeSession } from "./summarizer.js";
const MAX_JOBS_PER_RUN = 5;
async function processJob() {
    const job = db.claimPendingSummaryJob();
    if (!job)
        return false;
    try {
        const summary = await summarizeSession(job.session_id, job.project_id);
        if (!summary) {
            db.failSummaryJob(job.id, "No unfinalized session data found");
            return true;
        }
        db.completeSummaryJob(job.id, summary);
        return true;
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        db.failSummaryJob(job.id, message);
        return true;
    }
}
async function main() {
    for (let i = 0; i < MAX_JOBS_PER_RUN; i++) {
        const processed = await processJob();
        if (!processed)
            break;
    }
}
main().catch((error) => {
    console.error(error);
    process.exit(1);
});
