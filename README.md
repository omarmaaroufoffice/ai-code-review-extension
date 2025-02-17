# AI Conversation VS Code Extension

This VS Code extension creates an interactive environment where two AI personalities can engage in conversations with each other. The AIs have distinct personalities and discuss various topics ranging from technology and science to philosophy and abstract concepts.

## Features

- Two distinct AI personalities:
  - AI-1: A curious and analytical AI focused on technology and science
  - AI-2: A creative and philosophical AI interested in abstract concepts
- Automatic conversation generation on various interesting topics
- Clean and intuitive user interface
- Real-time conversation updates
- Theme-aware styling that matches your VS Code theme

## Requirements

- VS Code 1.85.0 or higher
- OpenAI API key

## Setup

1. Install the extension
2. The OpenAI API key is already configured system-wide. If you need to change it, you can set it in your `~/.zshrc` file:
   ```bash
   export OPENAI_API_KEY='your-api-key-here'
   ```
   Then run:
   ```bash
   source ~/.zshrc
   ```
3. Restart VS Code

## Usage

1. Open the Command Palette (Ctrl+Shift+P / Cmd+Shift+P)
2. Type "Start AI Conversation" and select the command
3. Click the "Start New Conversation" button in the webview panel
4. Watch as the AIs engage in an interesting discussion

## Extension Settings

This extension contributes the following settings:

* None currently - future versions will include customization options

## Known Issues

- The conversation length is currently limited to 5 turns
- Requires manual restart to change API key

## Release Notes

### 0.0.1

Initial release:
- Basic AI conversation functionality
- Simple UI with theme support
- OpenAI o3-mini integration

## Contributing

Feel free to submit issues and enhancement requests!