/**
 * 🤖 BOT INTEGRATION EXAMPLE
 * 
 * Shows how bots should connect to the Cloud Orchestrator
 * 
 * This replaces the old "check local file" approach with:
 * 1. Heartbeat every 60 seconds
 * 2. Poll for tasks
 * 3. Execute tasks
 * 4. Mark complete
 */

const fetch = require('node-fetch');

// ============================================
// CONFIGURATION
// ============================================

const CONFIG = {
  // Cloud orchestrator URL (Railway)
  ORCHESTRATOR_URL: process.env.ORCHESTRATOR_URL || 'https://your-app.up.railway.app',
  
  // API key for authentication
  API_KEY: process.env.ADMIN_KEY || process.env.API_KEY,
  
  // Bot identity
  BOT_NAME: process.env.BOT_NAME || 'cursor',
  
  // Intervals
  HEARTBEAT_INTERVAL: 60 * 1000,     // 60 seconds
  TASK_POLL_INTERVAL: 30 * 1000,     // 30 seconds
  
  // Version for debugging
  VERSION: '1.0.0'
};

// ============================================
// HEARTBEAT
// ============================================

async function sendHeartbeat(currentTask = null) {
  try {
    const response = await fetch(`${CONFIG.ORCHESTRATOR_URL}/api/heartbeat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-key': CONFIG.API_KEY
      },
      body: JSON.stringify({
        ai: CONFIG.BOT_NAME,
        status: 'online',
        currentTask: currentTask,
        version: CONFIG.VERSION
      })
    });
    
    const data = await response.json();
    
    if (response.ok) {
      console.log(`💓 Heartbeat OK - ${data.pendingTasks} tasks pending`);
      return data;
    } else {
      console.error(`❌ Heartbeat failed: ${data.error}`);
      return null;
    }
  } catch (error) {
    console.error(`❌ Heartbeat error: ${error.message}`);
    return null;
  }
}

// ============================================
// TASK POLLING
// ============================================

async function getTasks() {
  try {
    const response = await fetch(`${CONFIG.ORCHESTRATOR_URL}/api/inbox/${CONFIG.BOT_NAME}`, {
      headers: {
        'x-admin-key': CONFIG.API_KEY
      }
    });
    
    const data = await response.json();
    
    if (response.ok) {
      return data.tasks || [];
    } else {
      console.error(`❌ Get tasks failed: ${data.error}`);
      return [];
    }
  } catch (error) {
    console.error(`❌ Get tasks error: ${error.message}`);
    return [];
  }
}

// ============================================
// TASK COMPLETION
// ============================================

async function completeTask(taskId, notes, filesChanged = []) {
  try {
    const response = await fetch(`${CONFIG.ORCHESTRATOR_URL}/api/task/${taskId}/complete`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-key': CONFIG.API_KEY
      },
      body: JSON.stringify({
        completedBy: CONFIG.BOT_NAME,
        notes: notes,
        filesChanged: filesChanged,
        version: CONFIG.VERSION
      })
    });
    
    const data = await response.json();
    
    if (response.ok) {
      console.log(`✅ Task ${taskId} marked complete`);
      return true;
    } else {
      console.error(`❌ Complete task failed: ${data.error}`);
      return false;
    }
  } catch (error) {
    console.error(`❌ Complete task error: ${error.message}`);
    return false;
  }
}

// ============================================
// TASK EXECUTION (Implement your logic here!)
// ============================================

async function executeTask(task) {
  console.log(`\n🔨 Executing: ${task.task_id}`);
  console.log(`   Type: ${task.task_type}`);
  console.log(`   Priority: ${task.priority}`);
  console.log(`   Description: ${task.description}`);
  
  // Send heartbeat with current task
  await sendHeartbeat(task.task_id);
  
  try {
    // ===========================================
    // YOUR TASK LOGIC HERE!
    // ===========================================
    
    // Example: Route based on task type
    switch (task.task_type) {
      case 'DEPLOY':
        // await runDeployment(task);
        console.log('   📦 Would run deployment...');
        break;
        
      case 'FIX':
        // await runBugFix(task);
        console.log('   🔧 Would run bug fix...');
        break;
        
      case 'TEST':
        // await runTests(task);
        console.log('   🧪 Would run tests...');
        break;
        
      case 'CREATE':
        // await createFeature(task);
        console.log('   ✨ Would create feature...');
        break;
        
      default:
        console.log('   📋 Generic task execution...');
    }
    
    // Simulate work
    await new Promise(r => setTimeout(r, 2000));
    
    // Mark complete
    await completeTask(task.task_id, 'Task completed successfully', []);
    
    return true;
    
  } catch (error) {
    console.error(`   ❌ Task failed: ${error.message}`);
    
    // Optionally mark as failed or leave pending
    // await completeTask(task.task_id, `Failed: ${error.message}`);
    
    return false;
  }
}

// ============================================
// MAIN LOOP
// ============================================

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`   🤖 ${CONFIG.BOT_NAME.toUpperCase()} BOT STARTING`);
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`   Orchestrator: ${CONFIG.ORCHESTRATOR_URL}`);
  console.log(`   Version: ${CONFIG.VERSION}`);
  console.log(`   Heartbeat: Every ${CONFIG.HEARTBEAT_INTERVAL / 1000}s`);
  console.log(`   Task Poll: Every ${CONFIG.TASK_POLL_INTERVAL / 1000}s`);
  console.log('═══════════════════════════════════════════════════════════');
  
  // Initial heartbeat
  await sendHeartbeat();
  
  // Start heartbeat interval
  setInterval(() => sendHeartbeat(), CONFIG.HEARTBEAT_INTERVAL);
  
  // Main task loop
  while (true) {
    try {
      // Get pending tasks
      const tasks = await getTasks();
      
      if (tasks.length > 0) {
        console.log(`\n📬 Found ${tasks.length} pending task(s)`);
        
        // Execute tasks in order (highest priority first - they come sorted)
        for (const task of tasks) {
          await executeTask(task);
        }
      }
      
    } catch (error) {
      console.error('Loop error:', error.message);
    }
    
    // Wait before next poll
    await new Promise(r => setTimeout(r, CONFIG.TASK_POLL_INTERVAL));
  }
}

// ============================================
// RUN
// ============================================

// Check required config
if (!CONFIG.API_KEY) {
  console.error('❌ API_KEY or ADMIN_KEY environment variable required!');
  console.error('   Set: ADMIN_KEY=your-key-here');
  process.exit(1);
}

main().catch(console.error);
