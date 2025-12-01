import express from 'express';
import { spawn, exec } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

// LoadRunner test configurations - Real-world sequential load simulation
const LOADRUNNER_CONFIGS = {
  light: { journeyInterval: 30, duration: 600 },       // New user every 30 seconds for 10 minutes (20 users)
  medium: { journeyInterval: 15, duration: 900 },      // New user every 15 seconds for 15 minutes (60 users)  
  heavy: { journeyInterval: 10, duration: 1200 },      // New user every 10 seconds for 20 minutes (120 users)
  stress: { journeyInterval: 5, duration: 1800 },      // New user every 5 seconds for 30 minutes (360 users)
  extreme: { journeyInterval: 3, duration: 1800 },     // New user every 3 seconds for 30 minutes (600 users)
  peak: { journeyInterval: 2, duration: 1200 }         // New user every 2 seconds for 20 minutes (600 users)
};

// Active test sessions tracking
const activeTests = new Map();

/**
 * Generate LoadRunner script from JSON journey configuration - Sequential Load Simulation
 * Uses the same journey format as single simulation but generates multiple customers
 */
function generateLoadRunnerScript(journeyConfig, testConfig, errorSimulationEnabled = true) {
  try {
    const { companyName, domain, steps = [], additionalFields = {} } = journeyConfig;
    const testId = crypto.randomUUID();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    
    // Validate inputs
    if (!companyName || !domain) {
      throw new Error(`Invalid journey config: missing companyName or domain`);
    }
    
    if (!Array.isArray(steps)) {
      throw new Error(`Invalid steps: expected array, got ${typeof steps}`);
    }
    
    console.log(`🔧 Generating LoadRunner script for ${companyName} with ${steps.length} steps`);
  const LSN = `BizObs_${companyName.replace(/\s+/g, '')}_${domain}_Journey`;
  const LTN = `${companyName.replace(/\s+/g, '')}_LoadTest_${timestamp.split('T')[0].replace(/-/g, '')}`;
  
  const scriptHeader = `/*
 * LoadRunner Script Generated from BizObs Journey Configuration
 * Company: ${companyName}
 * Domain: ${domain}
 * Generated: ${new Date().toISOString()}
 * Test ID: ${testId}
 * 
 * Dynatrace LoadRunner Integration with Request Tagging
 * LSN: ${LSN} (Load Script Name)
 * TSN: Dynamic per step (Test Step Names)
 * LTN: ${LTN} (Load Test Name)
 */

#include "web_api.h"
#include "lrun.h"

// Global Dynatrace integration variables
char dt_test_header[1024];
char correlation_id[64];
char customer_id[64];
char session_id[64];
char trace_id[64];
char correlation_id[64];
char customer_id[64];
char session_id[64];
char trace_id[64];

// Demo customer profiles for realistic simulation
char* customer_names[] = {
    "Sarah Johnson", "Michael Chen", "Emma Rodriguez", "David Kim", 
    "Ashley Thompson", "Robert Martinez", "Jennifer Lee", "Christopher Brown",
    "Amanda Wilson", "Joshua Garcia", "Melissa Davis", "Andrew Miller",
    "Jessica Anderson", "Kevin Taylor", "Lauren Thomas", "Brian Jackson"
};

char* customer_emails[] = {
    "sarah.johnson@email.com", "michael.chen@email.com", "emma.rodriguez@email.com",
    "david.kim@email.com", "ashley.thompson@email.com", "robert.martinez@email.com",
    "jennifer.lee@email.com", "christopher.brown@email.com", "amanda.wilson@email.com",
    "joshua.garcia@email.com", "melissa.davis@email.com", "andrew.miller@email.com",
    "jessica.anderson@email.com", "kevin.taylor@email.com", "lauren.thomas@email.com",
    "brian.jackson@email.com"
};

char* customer_segments[] = {
    "Premium", "Standard", "Budget", "Enterprise", "SMB", "Startup"
};

char* traffic_sources[] = {
    "Google_Ads", "Facebook_Campaign", "Email_Newsletter", "Direct_Traffic",
    "Referral_Partner", "Organic_Search", "Social_Media", "Content_Marketing"
};

int vuser_init() {
    lr_output_message("Starting LoadRunner test for ${companyName}");
    
    // Initialize LoadRunner variables with proper Dynatrace tagging
    lr_save_string("BizObs-Journey-LoadTest", "LSN");  // Load Script Name
    lr_save_string("${companyName}_Performance_Test_${timestamp}", "LTN");  // Load Test Name
    
    // Generate unique customer profile for this virtual user
    srand(time(NULL) + lr_get_vuser_id());
    int customer_index = rand() % 16;
    lr_save_string(customer_names[customer_index], "customer_name");
    lr_save_string(customer_emails[customer_index], "customer_email");
    lr_save_string(customer_segments[rand() % 6], "customer_segment");
    lr_save_string(traffic_sources[rand() % 8], "traffic_source");
    
    // Set web replay settings for better performance
    web_set_max_html_param_len("1024000");
    web_set_max_retries("3");
    web_set_timeout("Receive", 30);
    web_set_user_agent("LoadRunner-BizObs-Agent/1.0");
    
    return 0;
}

int vuser_end() {
    lr_output_message("Completed LoadRunner test for ${companyName} - Customer: {customer_name}");
    return 0;
}

int Action() {
    int iteration = lr_get_iteration_number();
    int vuser_id = lr_get_vuser_id();
    
    // Generate unique correlation ID for each iteration
    sprintf(correlation_id, "LR_${LTN}_%d_%d_%d", vuser_id, iteration, (int)time(NULL));
    lr_save_string(correlation_id, "correlation_id");
    
    // Generate customer and session IDs with unique values per test run
    sprintf(customer_id, "customer_%d_%d_%d", vuser_id, iteration, (int)time(NULL) % 10000);
    sprintf(session_id, "session_${LSN}_%d_%d", vuser_id, iteration);
    sprintf(trace_id, "trace_%s_%d", correlation_id, (int)time(NULL));
    
    lr_save_string(customer_id, "customer_id");
    lr_save_string(session_id, "session_id");
    lr_save_string(trace_id, "trace_id");
    
    // Set up LoadRunner parameters for LSN/TSN/LTN
    lr_save_string("${LSN}", "LSN");  // Load Script Name
    lr_save_string("${LTN}", "LTN");  // Load Test Name
    
    lr_start_transaction("Full_Customer_Journey");
    lr_output_message("Starting journey for customer: {customer_name} ({customer_segment}) - Journey: %s", correlation_id);
`;

  // Generate step-specific transactions using same format as single simulation
  const stepTransactions = steps.map((step, index) => {
    let stepNameLabel = `Step_${index + 1}`;
    try {
      if (!step || typeof step !== 'object') {
        throw new Error(`Invalid step at index ${index}: ${JSON.stringify(step)}`);
      }
      
      const stepName = step.stepName || step.name || `Step_${index + 1}`;
      stepNameLabel = stepName;
      const stepDescription = step.description || step.stepDescription || '';
      const serviceName = step.serviceName || `${stepName}Service`;
      const estimatedDuration = step.estimatedDuration || step.duration || 5000;
      const substeps = step.substeps || [];
      
      // Convert duration to seconds for think time
      const thinkTimeSeconds = Math.floor(estimatedDuration / 1000) || 5;
      
      console.log(`Step ${index}: ${stepName}, duration: ${estimatedDuration}ms, thinkTime: ${thinkTimeSeconds}s`);
      
      return `
    // Step ${index + 1}: ${stepName} - ${stepDescription}
    lr_save_string("${stepName}", "TSN");  // Test Step Name for this step
    
    // Build X-dynaTrace header with LSN, TSN, LTN (same format as single simulation)
    sprintf(dt_test_header, "TSN=%s;LSN=%s;LTN=%s;VU=%d;SI=LoadRunner;PC=BizObs-Demo;AN=${companyName};CID=%s", 
            "${stepName}", "${LSN}", "${LTN}", lr_get_vuser_id(), "{correlation_id}");
    
    lr_start_transaction("${stepName}");
    lr_output_message("Executing step: ${stepName} (Service: ${serviceName}) for {customer_name}");
    
    // Add all headers exactly as single simulation does
    web_add_header("X-dynaTrace", dt_test_header);
    web_add_header("x-correlation-id", "{correlation_id}");
    web_add_header("x-customer-id", "{customer_id}");
    web_add_header("x-session-id", "{session_id}");
    web_add_header("x-trace-id", "{trace_id}");
    web_add_header("x-step-name", "${stepName}");
    web_add_header("x-service-name", "${serviceName}");
    web_add_header("x-customer-segment", "{customer_segment}");
    web_add_header("x-traffic-source", "{traffic_source}");
    web_add_header("x-test-iteration", lr_eval_string("{pIteration}"));
    web_add_header("Content-Type", "application/json");
    web_add_header("User-Agent", "LoadRunner-BizObs-Agent/1.0");
    
    // Use exact journey format as single simulation - with journey.steps structure
    web_custom_request("${stepName}_Journey_Step",
        "URL=http://localhost:8080/api/journey-simulation/simulate-journey",
        "Method=POST",
        "Resource=0",
        "RecContentType=application/json",
        "Body="
        "{"
        "\\"journeyId\\": \\"{correlation_id}\\","
        "\\"customerId\\": \\"{customer_id}\\","
        "\\"sessionId\\": \\"{session_id}\\","
        "\\"traceId\\": \\"{trace_id}\\","
        "\\"chained\\": true,"
        "\\"thinkTimeMs\\": 250,"
        "\\"errorSimulationEnabled\\": ${errorSimulationEnabled ? 'true' : 'false'},"
        "\\"journey\\": {"
        "  \\"journeyId\\": \\"{correlation_id}\\","
        "  \\"companyName\\": \\"${companyName}\\","
        "  \\"domain\\": \\"${domain}\\","
        "  \\"steps\\": ["
        "    {"
        "      \\"stepNumber\\": ${index + 1},"
        "      \\"stepName\\": \\"${stepName}\\","
        "      \\"serviceName\\": \\"${serviceName}\\","
        "      \\"description\\": \\"${stepDescription}\\","
        "      \\"estimatedDuration\\": ${estimatedDuration},"
        "      \\"substeps\\": ${JSON.stringify(substeps)}"
        "    }"
        "  ],"
        "  \\"additionalFields\\": ${JSON.stringify(additionalFields || {})},"
        "  \\"customerProfile\\": {"
        "    \\"name\\": \\"{customer_name}\\","
        "    \\"email\\": \\"{customer_email}\\","
        "    \\"segment\\": \\"{customer_segment}\\","
        "    \\"userId\\": \\"{customer_id}\\","
        "    \\"deviceType\\": \\"desktop\\","
        "    \\"location\\": \\"US-East\\""
        "  }"
        "}"
        "}",
        LAST);
    
    // Check response for errors and handle accordingly
    if (atoi(lr_eval_string("{status}")) >= 400) {
        lr_error_message("Step ${stepName} failed with status: %s", lr_eval_string("{status}"));
        lr_end_transaction("${stepName}", LR_FAIL);
    } else {
        lr_end_transaction("${stepName}", LR_PASS);
    }
    
    // Clear headers for next request
    web_cleanup_cookies();
    web_revert_auto_header("x-dynatrace-test");
    web_revert_auto_header("x-correlation-id");
    web_revert_auto_header("x-customer-id");
    web_revert_auto_header("x-session-id");
    web_revert_auto_header("x-trace-id");
    web_revert_auto_header("x-step-name");
    web_revert_auto_header("x-customer-segment");
    web_revert_auto_header("x-traffic-source");
    web_revert_auto_header("x-test-iteration");
    
    lr_end_transaction("{TSN}", LR_AUTO);
    lr_output_message("Completed step: {TSN} - Response time: %d ms", lr_get_transaction_duration("{TSN}"));
    
    // Variable think time based on step complexity
    lr_think_time(${thinkTimeSeconds});
`;
    } catch (stepError) {
      console.error(`❌ Error processing step ${index}:`, stepError);
      throw new Error(`Failed to process step ${index} (${stepNameLabel}): ${stepError.message}`);
    }
  }).join('\n');

  const scriptFooter = `
    lr_end_transaction("Full_Customer_Journey", LR_AUTO);
    
    // Log completion with full context
    lr_output_message("Journey completed for {customer_name} - Total time: %d ms, Correlation: {correlation_id}", 
                     lr_get_transaction_duration("Full_Customer_Journey"));
    
    // Optional: Add business events for completion tracking
    web_add_header("x-dynatrace-test", dt_test_header);
    web_add_header("x-correlation-id", "{correlation_id}");
    web_add_header("Content-Type", "application/json");
    
    web_custom_request("Journey_Completion_Event",
        "URL=http://localhost:8080/api/journey-simulation/simulate-journey",
        "Method=POST",
        "Resource=0",
        "RecContentType=application/json",
        "Body="
        "{"
        "\\"eventType\\": \\"journey_completed\\","
        "\\"correlationId\\": \\"{correlation_id}\\","
        "\\"customerId\\": \\"{customer_id}\\","
        "\\"companyName\\": \\"${companyName}\\","
        "\\"customerName\\": \\"{customer_name}\\","
        "\\"customerSegment\\": \\"{customer_segment}\\","
        "\\"totalSteps\\": ${steps.length},"
        "\\"loadTest\\": true,"
        "\\"completionTime\\": \\"" + lr_eval_string("{TimeNow}") + "\\""
        "}",
        LAST);
    
    return 0;
}`;

  return scriptHeader + stepTransactions + scriptFooter;
  } catch (error) {
    console.error('❌ Error generating LoadRunner script:', error);
    throw new Error(`Failed to generate LoadRunner script: ${error.message}`);
  }
}

/**
 * Generate LoadRunner scenario file for sequential load simulation
 */
function generateScenarioFile(journeyConfig, testConfig, scriptPath) {
  const { journeyInterval, duration, runUntilStopped } = testConfig;
  const fallbackDuration = 86400; // 24 hours for run-until-stopped mode
  const effectiveDuration = runUntilStopped ? fallbackDuration : (duration || fallbackDuration);
  const totalJourneys = runUntilStopped
    ? 0
    : Math.max(1, Math.floor(effectiveDuration / journeyInterval));
  
  const scenarioContent = `[General]
Version=1

[Groups]
Group1=1

[Group: Group1]
Scripts=BizObsJourneyTest
ScalabilityMode=1
LoadBehavior=goal
Goal=VUsersPerSec
GoalValue=1
RampUp=10
Duration=${effectiveDuration}
RampDown=10
IterationDelay=${journeyInterval}

[Scripts]
BizObsJourneyTest=${scriptPath}

[Runtime Settings]
ThinkTime=On
IterationDelay=Fixed
IterationDelaySeconds=${journeyInterval}
AutomaticTransactions=1
FailOnHttpErrors=1
MaxIterations=${runUntilStopped ? 0 : totalJourneys}
`;

  return scenarioContent;
}

/**
 * Create curl-based simulation script for sequential load testing
 */
function generateCurlSimulation(journeyConfig, testConfig, testDir, options = {}) {
  const { journeyInterval, duration, runUntilStopped } = testConfig;
  const { errorSimulationEnabled = true, stopFlagPath = path.join(testDir, '.stop-requested') } = options;
  const { companyName, domain, steps = [] } = journeyConfig;
  const testId = crypto.randomUUID();
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const effectiveDuration = runUntilStopped ? 0 : (duration || 600);
  
  // Demo customer data for realistic simulation - different customers for each test
  const customerProfiles = [
    { name: "Sarah Johnson", email: "sarah.johnson@email.com", segment: "Premium", source: "Google_Ads" },
    { name: "Michael Chen", email: "michael.chen@email.com", segment: "Standard", source: "Facebook_Campaign" },
    { name: "Emma Rodriguez", email: "emma.rodriguez@email.com", segment: "Budget", source: "Email_Newsletter" },
    { name: "David Kim", email: "david.kim@email.com", segment: "Enterprise", source: "Direct_Traffic" },
    { name: "Ashley Thompson", email: "ashley.thompson@email.com", segment: "SMB", source: "Referral_Partner" },
    { name: "Robert Martinez", email: "robert.martinez@email.com", segment: "Startup", source: "Organic_Search" },
    { name: "Jennifer Lee", email: "jennifer.lee@email.com", segment: "Premium", source: "Social_Media" },
    { name: "Christopher Brown", email: "christopher.brown@email.com", segment: "Standard", source: "Content_Marketing" },
    { name: "Amanda Wilson", email: "amanda.wilson@email.com", segment: "Budget", source: "Google_Ads" },
    { name: "Joshua Garcia", email: "joshua.garcia@email.com", segment: "Enterprise", source: "Facebook_Campaign" },
    { name: "Melissa Davis", email: "melissa.davis@email.com", segment: "Premium", source: "Email_Newsletter" },
    { name: "Andrew Miller", email: "andrew.miller@email.com", segment: "Standard", source: "Direct_Traffic" },
    { name: "Jessica Anderson", email: "jessica.anderson@email.com", segment: "SMB", source: "Referral_Partner" },
    { name: "Kevin Taylor", email: "kevin.taylor@email.com", segment: "Startup", source: "Organic_Search" },
    { name: "Lauren Thomas", email: "lauren.thomas@email.com", segment: "Premium", source: "Social_Media" },
    { name: "Brian Jackson", email: "brian.jackson@email.com", segment: "Standard", source: "Content_Marketing" }
  ];

  // Generate LSN/LTN for consistent Dynatrace tagging
  const LSN = `BizObs_${companyName.replace(/\s+/g, '')}_${domain}_Journey`;
  const LTN = `${companyName.replace(/\s+/g, '')}_LoadTest_${timestamp.split('T')[0].replace(/-/g, '')}`;

  const trafficSources = [
    "Google_Ads", "Facebook_Campaign", "Email_Newsletter", "Direct_Traffic",
    "Referral_Partner", "Organic_Search", "Social_Media", "Content_Marketing"
  ];
  
  const curlScript = `#!/bin/bash
# BizObs LoadRunner Simulation Script with Dynatrace Integration
# Generated: ${new Date().toISOString()}
# Following Dynatrace LoadRunner Request Tagging Best Practices

COMPANY_NAME="${companyName}"
DOMAIN="${domain}"
TEST_ID="${testId}"
JOURNEY_INTERVAL=${journeyInterval}
DURATION=${effectiveDuration}
BASE_URL="http://localhost:8080"
  RUN_UNTIL_STOPPED=${runUntilStopped ? 1 : 0}
  STOP_FILE="${stopFlagPath}"

  # Calculate total journeys for sequential execution (only used for fixed duration)
  if [ $RUN_UNTIL_STOPPED -eq 1 ]; then
    TOTAL_JOURNEYS=0
  else
    TOTAL_JOURNEYS=$((DURATION / JOURNEY_INTERVAL))
  fi

# Dynatrace LoadRunner Integration Variables
LSN="BizObs-Journey-LoadTest"  # Load Script Name
LTN="${companyName}_Performance_Test_${timestamp}"  # Load Test Name

echo "🚀 Starting BizObs Sequential Load Simulation for $COMPANY_NAME"
echo "📊 Journey Interval: ${journeyInterval}s, Total Duration: ${duration}s"
echo "🎯 Expected Journeys: $TOTAL_JOURNEYS (one every ${journeyInterval}s)"
echo "🏷️  Load Test Name: $LTN"
echo "📝 Load Script Name: $LSN"

# Create results directory
RESULTS_DIR="${testDir}/results"
mkdir -p "$RESULTS_DIR"

# Demo customer profiles
declare -a CUSTOMER_NAMES=(${customerProfiles.map(p => `"${p.name}"`).join(' ')})
declare -a CUSTOMER_EMAILS=(${customerProfiles.map(p => `"${p.email}"`).join(' ')})
declare -a CUSTOMER_SEGMENTS=(${customerProfiles.map(p => `"${p.segment}"`).join(' ')})
declare -a TRAFFIC_SOURCES=(${trafficSources.map(s => `"${s}"`).join(' ')})

# Start timestamp
START_TIME=$(date +%s)
END_TIME=$((START_TIME + DURATION))

# Function to execute a single customer journey
execute_customer_journey() {
    local journey_number=$1
    local log_file="$RESULTS_DIR/journey_$journey_number.log"
    
    # Assign unique customer profile for this journey
    local customer_index=$((journey_number % ${customerProfiles.length}))
    local customer_name="\${CUSTOMER_NAMES[$customer_index]}"
    local customer_email="\${CUSTOMER_EMAILS[$customer_index]}"
    local customer_segment="\${CUSTOMER_SEGMENTS[$customer_index]}"
    local traffic_source="\${TRAFFIC_SOURCES[$((RANDOM % ${trafficSources.length}))]}"
    
    local journey_start=$(date +%s)
    
    echo "$(date): Starting journey $journey_number - Customer: $customer_name ($customer_segment)" >> "$log_file"
    
    # Generate unique correlation ID for this customer journey
    local correlation_id="LR_\${LTN}_Journey_\${journey_number}_$(date +%s)"
    local customer_id="customer_journey_\${journey_number}"
    local session_id="session_\${LSN}_journey_\${journey_number}"
    local trace_id="trace_\${correlation_id}_$(date +%s)"
    
    echo "$(date): Journey \$journey_number - Customer: \$customer_name - Correlation: \$correlation_id" >> "$log_file"
        
        # Execute complete journey using same format as single simulation
        JOURNEY_PAYLOAD=$(cat <<EOF
{
  "journeyId": "\$correlation_id",
  "customerId": "\$customer_id", 
  "sessionId": "\$session_id",
  "traceId": "\$trace_id",
  "chained": true,
  "thinkTimeMs": 250,
  "errorSimulationEnabled": ${errorSimulationEnabled ? 'true' : 'false'},
  "journey": {
    "journeyId": "\$correlation_id",
    "companyName": "${companyName}",
    "domain": "${domain}",
    "steps": ${JSON.stringify(steps)},
    "additionalFields": ${JSON.stringify(journeyConfig.additionalFields || {})},
    "customerProfile": {
      "name": "\$customer_name",
      "email": "\$customer_email", 
      "segment": "\$customer_segment",
      "userId": "\$customer_id",
      "deviceType": "desktop",
      "location": "US-East"
    }
  }
}
EOF
)
        
        # Build X-dynaTrace header with LSN/TSN/LTN (same format as single simulation)
        DYNATRACE_HEADER="TSN=Full_Journey;LSN=${LSN};LTN=${LTN};VU=\$journey_number;SI=CurlSimulation;PC=BizObs-Demo;AN=${companyName};CID=\$correlation_id"
        
        echo "$(date): Journey \$journey_number starting full journey for \$customer_name" >> "$log_file"
        
        RESPONSE_TIME_START=$(date +%s%3N)
        HTTP_CODE=$(curl -s -w "%{http_code}" -o /dev/null \\
            -X POST \\
            -H "Content-Type: application/json" \\
            -H "X-dynaTrace: \$DYNATRACE_HEADER" \\
            -H "x-correlation-id: \$correlation_id" \\
            -H "x-customer-id: \$customer_id" \\
            -H "x-session-id: \$session_id" \\
            -H "x-trace-id: \$trace_id" \\
            -H "x-customer-segment: \$customer_segment" \\
            -H "x-traffic-source: \$traffic_source" \\
            -H "x-test-iteration: \$journey_number" \\
            -H "User-Agent: LoadRunner-BizObs-Agent/1.0" \\
            -d "\$JOURNEY_PAYLOAD" \\
            "\$BASE_URL/api/journey-simulation/simulate-journey")
        
        RESPONSE_TIME_END=$(date +%s%3N)
        RESPONSE_TIME=$((RESPONSE_TIME_END - RESPONSE_TIME_START))
        
        echo "$(date): Journey \$journey_number - Full_Journey - HTTP: \$HTTP_CODE - Response Time: \${RESPONSE_TIME}ms - Correlation: \$correlation_id" >> "$log_file"
        
    # Send journey completion event
    curl -s -o /dev/null \\
        -X POST \\
        -H "Content-Type: application/json" \\
        -H "X-dynaTrace: TSN=Journey_Completion;LSN=${LSN};LTN=${LTN};VU=\$journey_number;SI=CurlSimulation;PC=BizObs-Demo;AN=${companyName};CID=\$correlation_id" \\
        -H "x-correlation-id: \$correlation_id" \\
        -d '{
            "eventType": "journey_completed",
            "correlationId": "'\$correlation_id'",
            "customerId": "'\$customer_id'",
            "companyName": "${companyName}",
            "customerName": "'\$customer_name'",
            "customerSegment": "'\$customer_segment'",
            "totalSteps": ${steps.length},
            "loadTest": true,
            "completionTime": "'$(date -Iseconds)'"
        }' \\
        "\$BASE_URL/api/journey-simulation/simulate-journey"
    
    local journey_end=$(date +%s)
    local journey_time=$((journey_end - journey_start))
    echo "$(date): Journey \$journey_number completed for \$customer_name in \${journey_time}s" >> "$log_file"
}

# Execute sequential customer journeys
journey_number=1
echo "$(date): Starting sequential load simulation..."

if [ $RUN_UNTIL_STOPPED -eq 1 ]; then
  echo "♾️  Run-until-stopped mode enabled. Use stop runner to finish gracefully."
fi

while true; do
  if [ $RUN_UNTIL_STOPPED -eq 1 ]; then
    if [ -f "$STOP_FILE" ]; then
      echo "$(date): Stop requested. Finishing after in-flight journeys..."
      break
    fi
  else
    if [ $(date +%s) -ge $END_TIME ] || [ $journey_number -gt $TOTAL_JOURNEYS ]; then
      break
    fi
    echo "$(date): Executing customer journey $journey_number of $TOTAL_JOURNEYS"
  fi
  if [ $RUN_UNTIL_STOPPED -eq 1 ]; then
    echo "$(date): Executing continuous customer journey $journey_number"
  fi
    
    # Execute journey in background to allow for next journey scheduling
    execute_customer_journey $journey_number &
    journey_pid=$!
    
    # Increment journey counter
    journey_number=$((journey_number + 1))
    
    # Wait for journey interval before starting next journey
    if [ $RUN_UNTIL_STOPPED -eq 1 ]; then
      if [ -f "$STOP_FILE" ]; then
        echo "$(date): Stop requested during wait window. Ending loop."
        break
      fi
      echo "$(date): Waiting ${journeyInterval}s before next continuous journey..."
      sleep $JOURNEY_INTERVAL
    else
      if [ $journey_number -le $TOTAL_JOURNEYS ] && [ $(date +%s) -lt $END_TIME ]; then
        echo "$(date): Waiting ${journeyInterval}s before next journey..."
        sleep $JOURNEY_INTERVAL
      fi
    fi
done

# Wait for any remaining journeys to complete
echo "$(date): Waiting for remaining journeys to complete..."
wait

echo "🏁 Sequential load test completed. Results in: $RESULTS_DIR"
  echo "📊 Total journeys executed: $((journey_number - 1))"

# Generate summary report
echo "📊 Generating test summary..."
cat > "$RESULTS_DIR/test_summary.html" << EOF
<!DOCTYPE html>
<html>
<head>
    <title>BizObs LoadRunner Test Results - $COMPANY_NAME</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        .header { background: #f0f0f0; padding: 15px; border-radius: 5px; }
        .metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; margin: 20px 0; }
        .metric { background: #fff; border: 1px solid #ddd; padding: 15px; border-radius: 5px; text-align: center; }
        .metric h3 { margin: 0 0 10px 0; color: #333; }
        .metric .value { font-size: 24px; font-weight: bold; color: #007acc; }
        .logs { background: #f9f9f9; padding: 15px; border-radius: 5px; max-height: 400px; overflow-y: auto; }
    </style>
</head>
<body>
    <div class="header">
        <h1>BizObs LoadRunner Test Results</h1>
        <p><strong>Company:</strong> $COMPANY_NAME</p>
        <p><strong>Domain:</strong> $DOMAIN</p>
        <p><strong>Test ID:</strong> $TEST_ID</p>
        <p><strong>Duration:</strong> ${duration} seconds</p>
        <p><strong>Virtual Users:</strong> $VIRTUAL_USERS</p>
        <p><strong>Generated:</strong> $(date)</p>
    </div>
    
    <div class="metrics">
        <div class="metric">
            <h3>Total Requests</h3>
            <div class="value">$(grep -h "executing" $RESULTS_DIR/user_*.log | wc -l)</div>
        </div>
        <div class="metric">
            <h3>Successful Requests</h3>
            <div class="value">$(grep -h "HTTP: 200" $RESULTS_DIR/user_*.log | wc -l)</div>
        </div>
        <div class="metric">
            <h3>Failed Requests</h3>
            <div class="value">$(grep -hv "HTTP: 200" $RESULTS_DIR/user_*.log | grep "HTTP:" | wc -l)</div>
        </div>
        <div class="metric">
            <h3>Journey Steps</h3>
            <div class="value">${steps.length}</div>
        </div>
    </div>
    
    <h2>Test Execution Logs</h2>
    <div class="logs">
        <pre>$(head -100 $RESULTS_DIR/user_*.log)</pre>
    </div>
    
    <h2>Dynatrace Analysis</h2>
    <p>Filter your Dynatrace analysis using:</p>
    <ul>
        <li><strong>Test Name:</strong> $TEST_ID</li>
        <li><strong>Service:</strong> bizobs-main-server</li>
        <li><strong>Request Attribute:</strong> x-dynatrace-test contains "BizObs-Journey-Test"</li>
    </ul>
</body>
</html>
EOF

echo "✅ Test summary generated: $RESULTS_DIR/test_summary.html"
`;

  return curlScript;
}

/**
 * Start LoadRunner test from JSON journey
 */
router.post('/start-test', async (req, res) => {
  try {
    const {
      journeyConfig,
      testProfile = 'medium',
      durationMinutes = 5,
      customConfig = null,
      errorSimulationEnabled = true,
      runUntilStopped = false
    } = req.body;

    if (!journeyConfig || !journeyConfig.steps || journeyConfig.steps.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Valid journey configuration with steps is required'
      });
    }

    // Get test configuration
    const baseConfig = customConfig || {
      ...LOADRUNNER_CONFIGS[testProfile],
      duration: durationMinutes * 60
    };

    const testConfig = {
      ...baseConfig,
      duration: runUntilStopped ? null : baseConfig.duration,
      runUntilStopped: Boolean(runUntilStopped)
    };

    const testId = crypto.randomUUID();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const testDir = path.join(__dirname, '..', 'loadrunner-tests', `${journeyConfig.companyName || 'test'}_${timestamp}`);

    // Create test directory
    await fs.mkdir(testDir, { recursive: true });

    const stopFlagPath = path.join(testDir, '.stop-requested');
    try {
      await fs.unlink(stopFlagPath);
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }

    // Generate LoadRunner script
    const lrScript = generateLoadRunnerScript(journeyConfig, testConfig, errorSimulationEnabled);
    const scriptPath = path.join(testDir, 'BizObsJourneyTest.c');
    await fs.writeFile(scriptPath, lrScript);

    // Generate scenario file
    const scenarioContent = generateScenarioFile(journeyConfig, testConfig, scriptPath);
    const scenarioPath = path.join(testDir, 'BizObsJourney.lrs');
    await fs.writeFile(scenarioPath, scenarioContent);

    // Generate curl simulation as fallback
    const curlScript = generateCurlSimulation(journeyConfig, testConfig, testDir, {
      errorSimulationEnabled,
      stopFlagPath
    });
    const curlScriptPath = path.join(testDir, 'run_simulation.sh');
    await fs.writeFile(curlScriptPath, curlScript);
    await fs.chmod(curlScriptPath, '755');

    // Create test metadata
    const testMetadata = {
      testId,
      startTime: new Date().toISOString(),
      journeyConfig,
      testConfig,
      testDir,
      scriptPath,
      scenarioPath,
      curlScriptPath,
      status: 'initialized',
      runUntilStopped: Boolean(runUntilStopped),
      stopRequested: false,
      stopFlagPath
    };

    activeTests.set(testId, testMetadata);

    // Try to detect LoadRunner installation
    let loadRunnerAvailable = false;
    try {
      await new Promise((resolve, reject) => {
        exec('which mmdrv || which wlrun', (error, stdout) => {
          if (error) reject(error);
          else resolve(stdout);
        });
      });
      loadRunnerAvailable = true;
    } catch (e) {
      console.log('[LoadRunner] LoadRunner not detected, will use curl simulation');
    }

    // Start the test
    let testProcess;
    if (loadRunnerAvailable) {
      // Start LoadRunner test
      testProcess = spawn('wlrun', ['-TestPath', scenarioPath, '-Run'], {
        cwd: testDir,
        stdio: ['pipe', 'pipe', 'pipe']
      });
      testMetadata.method = 'loadrunner';
    } else {
      // Start curl simulation
      testProcess = spawn('bash', [curlScriptPath], {
        cwd: testDir,
        stdio: ['pipe', 'pipe', 'pipe']
      });
      testMetadata.method = 'curl-simulation';
    }

    testMetadata.process = testProcess;
    testMetadata.status = 'running';

    // Handle process output
    let output = '';
    testProcess.stdout.on('data', (data) => {
      output += data.toString();
      console.log(`[LoadRunner-${testId}] ${data.toString().trim()}`);
    });

    testProcess.stderr.on('data', (data) => {
      console.error(`[LoadRunner-${testId}] ERROR: ${data.toString().trim()}`);
    });

    testProcess.on('close', async (code) => {
      console.log(`[LoadRunner-${testId}] Test completed with code: ${code}`);
      if (testMetadata.stopRequested) {
        testMetadata.status = 'stopped';
      } else {
        testMetadata.status = code === 0 ? 'completed' : 'failed';
      }
      testMetadata.endTime = new Date().toISOString();
      testMetadata.exitCode = code;

      // Save test output
      await fs.writeFile(path.join(testDir, 'test_output.log'), output);

      if (testMetadata.stopFlagPath) {
        try {
          await fs.unlink(testMetadata.stopFlagPath);
        } catch (error) {
          if (error.code !== 'ENOENT') {
            console.warn(`[LoadRunner-${testId}] Unable to remove stop flag:`, error.message);
          }
        }
      }
    });

    const estimatedDurationLabel = testConfig.runUntilStopped
      ? 'Until stopped manually'
      : `${Math.ceil((testConfig.duration || 60) / 60)} minutes`;

    res.json({
      success: true,
      testId,
      message: `LoadRunner test started for ${journeyConfig.companyName || 'test company'}`,
      testConfig,
      method: testMetadata.method,
      estimatedDuration: estimatedDurationLabel,
      runUntilStopped: testConfig.runUntilStopped,
      resultsPath: testDir,
      monitoringUrl: `/api/loadrunner/status/${testId}`
    });

  } catch (error) {
    console.error('[LoadRunner] Error starting test:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Get test status
 */
router.get('/status/:testId', async (req, res) => {
  try {
    const { testId } = req.params;
    const testData = activeTests.get(testId);

    if (!testData) {
      return res.status(404).json({
        success: false,
        error: 'Test not found'
      });
    }

    // Check if results are available
    let results = null;
    const resultsPath = path.join(testData.testDir, 'results', 'test_summary.html');
    
    try {
      await fs.access(resultsPath);
      results = {
        summaryPath: resultsPath,
        available: true
      };
    } catch (e) {
      results = { available: false };
    }

    res.json({
      success: true,
      testId,
      status: testData.status,
      method: testData.method,
      startTime: testData.startTime,
      endTime: testData.endTime,
      testConfig: testData.testConfig,
      journeyConfig: {
        companyName: testData.journeyConfig.companyName,
        stepCount: testData.journeyConfig.steps.length
      },
      runUntilStopped: Boolean(testData.runUntilStopped),
      stopRequested: Boolean(testData.stopRequested),
      results
    });

  } catch (error) {
    console.error('[LoadRunner] Error getting test status:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * List all tests
 */
router.get('/tests', (req, res) => {
  try {
    const tests = Array.from(activeTests.entries()).map(([testId, data]) => ({
      testId,
      status: data.status,
      method: data.method,
      startTime: data.startTime,
      endTime: data.endTime,
      companyName: data.journeyConfig.companyName,
      stepCount: data.journeyConfig.steps.length,
      virtualUsers: data.testConfig.virtualUsers || 1,
      duration: data.testConfig.duration,
      runUntilStopped: Boolean(data.runUntilStopped),
      stopRequested: Boolean(data.stopRequested)
    }));

    res.json({
      success: true,
      tests,
      activeCount: tests.filter(t => t.status === 'running').length,
      totalCount: tests.length
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Stop a running test
 */
router.post('/stop/:testId', async (req, res) => {
  try {
    const { testId } = req.params;
    const testData = activeTests.get(testId);

    if (!testData) {
      return res.status(404).json({
        success: false,
        error: 'Test not found'
      });
    }

    const gracefulStopSupported = testData.runUntilStopped && testData.method === 'curl-simulation';

    if (gracefulStopSupported) {
      const stopFilePath = testData.stopFlagPath || path.join(testData.testDir, '.stop-requested');
      testData.stopFlagPath = stopFilePath;
      if (!testData.stopRequested) {
        await fs.writeFile(stopFilePath, `stop requested at ${new Date().toISOString()}\n`);
        testData.stopRequested = true;
        testData.status = 'stopping';
        return res.json({
          success: true,
          message: 'Stop requested. Runner will finish after the current journey.',
          testId,
          mode: 'graceful'
        });
      }

      return res.json({
        success: true,
        message: 'Stop already requested. Waiting for runner to exit.',
        testId,
        mode: 'graceful'
      });
    }

    if (testData.process && testData.status === 'running') {
      testData.process.kill('SIGTERM');
      testData.status = 'stopped';
      testData.stopRequested = true;
      testData.endTime = new Date().toISOString();

      return res.json({
        success: true,
        message: 'Test stopped successfully',
        testId,
        mode: 'force'
      });
    }

    res.json({
      success: true,
      message: 'Test was not running',
      testId,
      status: testData.status
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Get test results
 */
router.get('/results/:testId', async (req, res) => {
  try {
    const { testId } = req.params;
    const testData = activeTests.get(testId);

    if (!testData) {
      return res.status(404).json({
        success: false,
        error: 'Test not found'
      });
    }

    const resultsDir = path.join(testData.testDir, 'results');
    const summaryPath = path.join(resultsDir, 'test_summary.html');

    try {
      const summaryContent = await fs.readFile(summaryPath, 'utf8');
      res.set('Content-Type', 'text/html');
      res.send(summaryContent);
    } catch (e) {
      res.status(404).json({
        success: false,
        error: 'Test results not yet available'
      });
    }

  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Get available test profiles
 */
router.get('/profiles', (req, res) => {
  res.json({
    success: true,
    profiles: Object.keys(LOADRUNNER_CONFIGS).map(key => ({
      name: key,
      ...LOADRUNNER_CONFIGS[key],
      description: {
        light: 'Light sequential load - One journey every 2 minutes',
        medium: 'Medium sequential load - One journey every 1 minute',
        heavy: 'Heavy sequential load - One journey every 30 seconds',
        stress: 'Stress sequential load - One journey every 15 seconds'
      }[key]
    }))
  });
});

export default router;