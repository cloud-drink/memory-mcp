import { db } from "../db.js";
async function runTests() {
    console.log("--- Starting Database Module Tests ---");
    const projectId = "test-project-123";
    // 1. Test: Remember
    console.log("\n1. Testing 'remember'...");
    const memId = db.addMemory(projectId, "The project architecture uses a micro-kernel pattern.", "fact");
    console.log(`Memory saved. ID: ${memId}`);
    // 2. Test: Search
    console.log("\n2. Testing 'search_memory'...");
    const results = db.searchMemory(projectId, "architecture");
    console.log("Search Results (query: 'architecture'):", JSON.stringify(results, null, 2));
    if (results.length > 0 && results[0].content.includes("micro-kernel")) {
        console.log("鉁 Search success!");
    }
    else {
        console.log("鉁 Search failed or returned unexpected results.");
    }
    // 3. Test: Activity Logging
    console.log("\n3. Testing 'record_activity'...");
    const activityId = db.recordActivity({
        project_id: projectId,
        tool_name: "read_file",
        arguments: JSON.stringify({ path: "src/index.ts" }),
        files_accessed: "src/index.ts",
        result_summary: "File read successfully, 150 lines found.",
        is_success: 1
    });
    console.log(`Activity logged. ID: ${activityId}`);
    // 4. Test: Activity Query
    console.log("\n4. Testing 'query_activity'...");
    const activities = db.queryActivity(projectId, 5);
    console.log("Recent Activities:", JSON.stringify(activities, null, 2));
    if (activities.length > 0 && activities[0].tool_name === "read_file") {
        console.log("鉁 Activity query success!");
    }
    else {
        console.log("鉁 Activity query failed.");
    }
    // 5. Test: Global memory search
    console.log("\n5. Testing global memory scope...");
    db.addMemory("global", "This is a global company-wide policy.", "policy");
    const globalResults = db.searchMemory(projectId, "policy");
    console.log("Search Results for local project including global (query: 'policy'):", JSON.stringify(globalResults, null, 2));
    if (globalResults.length > 0) {
        console.log("鉁 Global scope retrieval success!");
    }
    console.log("\n--- All Tests Completed ---");
}
runTests().catch(err => {
    console.error("Test failed:", err);
    process.exit(1);
});
