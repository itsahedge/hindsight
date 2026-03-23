#!/bin/bash
set -e

echo "Installing Hindsight Memory Plugin for Claude Code..."

# Check Claude Code is available
if ! command -v claude &> /dev/null; then
    echo "Error: 'claude' command not found. Please install Claude Code first."
    echo "  See: https://docs.anthropic.com/en/docs/claude-code"
    exit 1
fi

# Check Python version
if ! command -v python3 &> /dev/null; then
    echo "Error: Python 3 not found. Please install Python 3.8+"
    exit 1
fi

PYTHON_VERSION=$(python3 -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')
echo "Found Python $PYTHON_VERSION"

# Add marketplace and install plugin
echo ""
echo "Adding Hindsight marketplace..."
claude plugin marketplace add vectorize-io/hindsight --sparse hindsight-integrations

echo ""
echo "Installing hindsight-memory plugin..."
claude plugin install hindsight-memory

echo ""
echo "Plugin installed successfully!"
echo ""
echo "Next steps:"
echo ""
echo "1. Configure your LLM provider for memory extraction:"
echo "   # Option A: OpenAI (auto-detected)"
echo "   export OPENAI_API_KEY=\"sk-your-key\""
echo ""
echo "   # Option B: Anthropic (auto-detected)"
echo "   export ANTHROPIC_API_KEY=\"your-key\""
echo ""
echo "2. Or connect to an external Hindsight server:"
echo "   Edit the plugin settings.json and set hindsightApiUrl"
echo ""
echo "3. Start Claude Code — the plugin will activate automatically."
echo ""
echo "On first use with daemon mode, uvx will download hindsight-embed (no manual install needed)."
