#!/bin/bash
# Sample custom monitor script for backup testing
# This script would be uploaded to /nsconfig/monitors/ on the NetScaler
# Usage: Called by USER type monitor with arguments: <host> <port>

HOST=$1
PORT=$2

# Simple HTTP check - returns 0 for success, non-zero for failure
response=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 5 "http://${HOST}:${PORT}/health" 2>/dev/null)

if [ "$response" = "200" ]; then
    echo "UP"
    exit 0
else
    echo "DOWN - HTTP $response"
    exit 1
fi
