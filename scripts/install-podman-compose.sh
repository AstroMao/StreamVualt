#!/bin/bash
# Script to install podman-compose

echo "Installing podman-compose..."

# Check if pip3 is installed
if ! command -v pip3 &> /dev/null; then
    echo "pip3 is not installed. Installing pip3..."
    
    # Check the OS
    if command -v apt-get &> /dev/null; then
        # Debian/Ubuntu
        sudo apt-get update
        sudo apt-get install -y python3-pip
    elif command -v dnf &> /dev/null; then
        # Fedora
        sudo dnf install -y python3-pip
    elif command -v yum &> /dev/null; then
        # CentOS/RHEL
        sudo yum install -y python3-pip
    elif command -v pacman &> /dev/null; then
        # Arch Linux
        sudo pacman -S python-pip
    elif command -v brew &> /dev/null; then
        # macOS with Homebrew
        brew install python3
    else
        echo "Could not determine package manager. Please install pip3 manually."
        exit 1
    fi
fi

# Install podman-compose using pip
pip3 install podman-compose

# Check if installation was successful
if command -v podman-compose &> /dev/null; then
    echo "podman-compose installed successfully!"
    echo "You can now use 'npm run podman:build' and 'npm run podman:up' to build and run the containers."
else
    echo "Failed to install podman-compose. Please install it manually:"
    echo "pip3 install podman-compose"
    exit 1
fi
