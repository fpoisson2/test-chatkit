#!/bin/bash
# Setup Redis sysctl configuration for vm.overcommit_memory
# See: https://github.com/jemalloc/jemalloc/issues/1328
#
# This script configures vm.overcommit_memory=1 which Redis recommends
# to avoid background save failures under low memory conditions.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SYSCTL_FILE="$SCRIPT_DIR/99-redis-overcommit.conf"

# Check if running as root
if [ "$EUID" -ne 0 ]; then
    echo "This script must be run as root (use sudo)"
    exit 1
fi

# Check current value
CURRENT_VALUE=$(sysctl -n vm.overcommit_memory)
echo "Current vm.overcommit_memory value: $CURRENT_VALUE"

if [ "$CURRENT_VALUE" = "1" ]; then
    echo "vm.overcommit_memory is already set to 1. No changes needed."
    exit 0
fi

# Apply immediately
echo "Setting vm.overcommit_memory=1..."
sysctl vm.overcommit_memory=1

# Install persistent configuration
if [ -d /etc/sysctl.d ]; then
    echo "Installing persistent configuration to /etc/sysctl.d/..."
    cp "$SYSCTL_FILE" /etc/sysctl.d/
    echo "Configuration will persist after reboot."
else
    echo "Warning: /etc/sysctl.d does not exist."
    echo "Add 'vm.overcommit_memory = 1' to /etc/sysctl.conf manually for persistence."
fi

echo "Done! vm.overcommit_memory is now set to 1."
